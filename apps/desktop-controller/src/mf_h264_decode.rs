//! Media Foundation H264 硬解。打不开或未出图时由上层回退软解。

use std::mem::ManuallyDrop;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use windows::Win32::Media::MediaFoundation::{
    CMSH264DecoderMFT, IMFSample, IMFTransform, MFCreateMediaType, MFCreateMemoryBuffer, MFCreateSample,
    MFMediaType_Video, MFStartup, MFVideoFormat_H264, MFVideoFormat_NV12, MFSTARTUP_FULL,
    MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, MFT_MESSAGE_NOTIFY_START_OF_STREAM, MFT_OUTPUT_DATA_BUFFER,
    MFT_OUTPUT_STREAM_PROVIDES_SAMPLES, MF_E_TRANSFORM_NEED_MORE_INPUT, MF_E_TRANSFORM_STREAM_CHANGE,
    MF_MT_FRAME_SIZE, MF_MT_MAJOR_TYPE, MF_MT_SUBTYPE, MF_VERSION,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};

use crate::color_nv12::nv12_to_bgr;

static MF_READY: AtomicBool = AtomicBool::new(false);
static DECODER: Mutex<Option<MfH264Decoder>> = Mutex::new(None);

struct MfH264Decoder {
    transform: IMFTransform,
    output_provides_samples: bool,
    output_buffer_size: u32,
    width: u32,
    height: u32,
}

// COM 句柄只在进程内串行通过 Mutex 使用。
unsafe impl Send for MfH264Decoder {}


enum DrainResult {
    HasMore,
    NeedInput,
    StreamChange,
    Failed,
}

fn ensure_mf() -> bool {
    if MF_READY.load(Ordering::Relaxed) {
        return true;
    }
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        if MFStartup(MF_VERSION, MFSTARTUP_FULL).is_err() {
            return false;
        }
    }
    MF_READY.store(true, Ordering::Relaxed);
    true
}

fn pack_u32_pair(high: u32, low: u32) -> u64 {
    ((high as u64) << 32) | (low as u64)
}

fn open_decoder() -> Option<MfH264Decoder> {
    if !ensure_mf() {
        return None;
    }
    let transform: IMFTransform =
        unsafe { CoCreateInstance(&CMSH264DecoderMFT, None, CLSCTX_INPROC_SERVER).ok()? };
    unsafe {
        let input = MFCreateMediaType().ok()?;
        input.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video).ok()?;
        input.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264).ok()?;
        transform.SetInputType(0, &input, 0).ok()?;
        if !set_nv12_output(&transform, 64, 48) {
            return None;
        }
        transform
            .ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)
            .ok()?;
        transform
            .ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)
            .ok()?;
    }
    let info = unsafe { transform.GetOutputStreamInfo(0).ok()? };
    let output_provides_samples = (info.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32) != 0;
    Some(MfH264Decoder {
        transform,
        output_provides_samples,
        output_buffer_size: info.cbSize.max(1 << 16),
        width: 64,
        height: 48,
    })
}

fn set_nv12_output(transform: &IMFTransform, width: u32, height: u32) -> bool {
    unsafe {
        let mut index = 0u32;
        loop {
            let Ok(candidate) = transform.GetOutputAvailableType(0, index) else {
                break;
            };
            let Ok(subtype) = candidate.GetGUID(&MF_MT_SUBTYPE) else {
                index += 1;
                continue;
            };
            if subtype == MFVideoFormat_NV12 {
                let _ = candidate.SetUINT64(&MF_MT_FRAME_SIZE, pack_u32_pair(width, height));
                return transform.SetOutputType(0, &candidate, 0).is_ok();
            }
            index += 1;
        }
        let Ok(output) = MFCreateMediaType() else {
            return false;
        };
        if output.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video).is_err() {
            return false;
        }
        if output.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12).is_err() {
            return false;
        }
        let _ = output.SetUINT64(&MF_MT_FRAME_SIZE, pack_u32_pair(width, height));
        transform.SetOutputType(0, &output, 0).is_ok()
    }
}

/// 尝试硬解；失败返回 None，由上层软解。
pub fn try_decode_annex_b_to_bgr(annex_b: &[u8]) -> Option<(u32, u32, Vec<u8>)> {
    if !session_core::looks_like_annex_b(annex_b) {
        return None;
    }
    let mut guard = DECODER.lock().ok()?;
    if guard.is_none() {
        *guard = open_decoder();
    }
    let decoder = guard.as_mut()?;
    let sample = build_h264_sample(annex_b)?;
    unsafe {
        decoder.transform.ProcessInput(0, &sample, 0).ok()?;
    }
    let mut nv12 = Vec::new();
    loop {
        match drain_nv12(decoder, &mut nv12) {
            DrainResult::HasMore => continue,
            DrainResult::NeedInput => break,
            DrainResult::StreamChange => {
                if !renegotiate(decoder) {
                    return None;
                }
            }
            DrainResult::Failed => return None,
        }
    }
    if nv12.is_empty() {
        return None;
    }
    let width = decoder.width;
    let height = decoder.height;
    let bgr = nv12_to_bgr(&nv12, width, height)?;
    Some((width, height, bgr))
}

fn renegotiate(decoder: &mut MfH264Decoder) -> bool {
    if !set_nv12_output(&decoder.transform, decoder.width.max(16), decoder.height.max(16)) {
        return false;
    }
    if let Ok(media) = unsafe { decoder.transform.GetOutputCurrentType(0) } {
        if let Ok(size) = unsafe { media.GetUINT64(&MF_MT_FRAME_SIZE) } {
            decoder.width = (size >> 32) as u32;
            decoder.height = (size & 0xffff_ffff) as u32;
        }
    }
    if let Ok(info) = unsafe { decoder.transform.GetOutputStreamInfo(0) } {
        decoder.output_provides_samples = (info.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32) != 0;
        decoder.output_buffer_size = info.cbSize.max(1 << 16);
    }
    true
}

fn drain_nv12(decoder: &MfH264Decoder, nv12: &mut Vec<u8>) -> DrainResult {
    unsafe {
        let sample = if decoder.output_provides_samples {
            None
        } else {
            let Ok(buffer) = MFCreateMemoryBuffer(decoder.output_buffer_size) else {
                return DrainResult::Failed;
            };
            let Ok(sample) = MFCreateSample() else {
                return DrainResult::Failed;
            };
            if sample.AddBuffer(&buffer).is_err() {
                return DrainResult::Failed;
            }
            Some(sample)
        };
        let mut buffers = [MFT_OUTPUT_DATA_BUFFER {
            dwStreamID: 0,
            pSample: ManuallyDrop::new(sample),
            dwStatus: 0,
            pEvents: ManuallyDrop::new(None),
        }];
        let mut status = 0u32;
        let result = decoder.transform.ProcessOutput(0, &mut buffers, &mut status);
        let out_sample = ManuallyDrop::take(&mut buffers[0].pSample);
        let _events = ManuallyDrop::take(&mut buffers[0].pEvents);
        match result {
            Ok(()) => {
                if let Some(sample) = out_sample {
                    if append_sample_bytes(&sample, nv12).is_none() {
                        return DrainResult::Failed;
                    }
                }
                DrainResult::HasMore
            }
            Err(error) if error.code() == MF_E_TRANSFORM_NEED_MORE_INPUT => DrainResult::NeedInput,
            Err(error) if error.code() == MF_E_TRANSFORM_STREAM_CHANGE => DrainResult::StreamChange,
            Err(_) => DrainResult::Failed,
        }
    }
}

fn build_h264_sample(bytes: &[u8]) -> Option<IMFSample> {
    unsafe {
        let buffer = MFCreateMemoryBuffer(bytes.len() as u32).ok()?;
        let mut raw = ptr::null_mut();
        let mut max_length = 0u32;
        buffer.Lock(&mut raw, Some(&mut max_length), None).ok()?;
        if raw.is_null() || (max_length as usize) < bytes.len() {
            let _ = buffer.Unlock();
            return None;
        }
        ptr::copy_nonoverlapping(bytes.as_ptr(), raw, bytes.len());
        let _ = buffer.Unlock();
        buffer.SetCurrentLength(bytes.len() as u32).ok()?;
        let sample = MFCreateSample().ok()?;
        sample.AddBuffer(&buffer).ok()?;
        Some(sample)
    }
}

fn append_sample_bytes(sample: &IMFSample, out: &mut Vec<u8>) -> Option<()> {
    unsafe {
        let buffer = sample.ConvertToContiguousBuffer().ok()?;
        let mut raw = ptr::null_mut();
        let mut current = 0u32;
        buffer.Lock(&mut raw, None, Some(&mut current)).ok()?;
        if !raw.is_null() && current > 0 {
            let slice = std::slice::from_raw_parts(raw, current as usize);
            out.extend_from_slice(slice);
        }
        let _ = buffer.Unlock();
    }
    Some(())
}
