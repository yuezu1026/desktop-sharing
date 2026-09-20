//! Media Foundation H264。优先枚举硬件 MFT，否则用系统 CMSH264EncoderMFT（同步）。
//! 输出统一成 Annex-B；打不开则由上层回退 OpenH264。

use std::mem::ManuallyDrop;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};

use windows::Win32::Media::MediaFoundation::{
    eAVEncH264VProfile_Base, CMSH264EncoderMFT, IMFActivate, IMFSample, IMFTransform,
    MFCreateMediaType, MFCreateMemoryBuffer, MFCreateSample, MFMediaType_Video, MFStartup,
    MFTEnumEx, MFVideoFormat_H264, MFVideoFormat_NV12, MFVideoInterlace_Progressive, MFSTARTUP_FULL,
    MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_HARDWARE, MFT_ENUM_FLAG_SORTANDFILTER,
    MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, MFT_MESSAGE_NOTIFY_START_OF_STREAM, MFT_OUTPUT_DATA_BUFFER,
    MFT_OUTPUT_STREAM_PROVIDES_SAMPLES, MFT_REGISTER_TYPE_INFO, MF_E_TRANSFORM_NEED_MORE_INPUT,
    MF_MT_AVG_BITRATE, MF_MT_FRAME_RATE, MF_MT_FRAME_SIZE, MF_MT_INTERLACE_MODE, MF_MT_MAJOR_TYPE,
    MF_MT_MPEG2_PROFILE, MF_MT_SUBTYPE, MF_TRANSFORM_ASYNC, MF_TRANSFORM_ASYNC_UNLOCK, MF_VERSION,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
};

use crate::color_nv12::bgr_to_nv12;

static MF_READY: AtomicBool = AtomicBool::new(false);

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

pub struct MfH264Encoder {
    transform: IMFTransform,
    width: u32,
    height: u32,
    frame_index: u64,
    output_provides_samples: bool,
    output_buffer_size: u32,
    hardware: bool,
}

impl MfH264Encoder {
    pub fn open(width: u32, height: u32) -> Option<Self> {
        if !ensure_mf() || width < 16 || height < 16 || width % 2 != 0 || height % 2 != 0 {
            return None;
        }
        if let Some(encoder) = open_hardware(width, height) {
            return Some(encoder);
        }
        open_microsoft_software(width, height)
    }

    pub fn is_hardware(&self) -> bool {
        self.hardware
    }

    pub fn encode_bgr(&mut self, width: u32, height: u32, bgr: &[u8]) -> Option<Vec<u8>> {
        if width != self.width || height != self.height {
            *self = Self::open(width, height)?;
        }
        let nv12 = bgr_to_nv12(bgr, width, height)?;
        let sample = build_nv12_sample(&nv12, width, height, self.frame_index)?;
        self.frame_index = self.frame_index.saturating_add(1);
        unsafe {
            self.transform
                .ProcessInput(0, &sample, 0)
                .ok()?;
        }
        let mut bitstream = Vec::new();
        while drain_output(
            &self.transform,
            self.output_provides_samples,
            self.output_buffer_size,
            &mut bitstream,
        )? {}
        if bitstream.is_empty() {
            return None;
        }
        session_core::ensure_annex_b(&bitstream)
    }
}

fn open_hardware(width: u32, height: u32) -> Option<MfH264Encoder> {
    let activates = enumerate_hardware().ok()?;
    for activate in activates {
        if let Some(encoder) = activate_encoder(activate, width, height, true) {
            return Some(encoder);
        }
    }
    None
}

fn open_microsoft_software(width: u32, height: u32) -> Option<MfH264Encoder> {
    ensure_mf();
    let transform: IMFTransform =
        unsafe { CoCreateInstance(&CMSH264EncoderMFT, None, CLSCTX_INPROC_SERVER).ok()? };
    configure_transform(&transform, width, height)?;
    finish_encoder(transform, width, height, false)
}

fn enumerate_hardware() -> windows::core::Result<Vec<IMFActivate>> {
    unsafe {
        let output_type = MFT_REGISTER_TYPE_INFO {
            guidMajorType: MFMediaType_Video,
            guidSubtype: MFVideoFormat_H264,
        };
        let mut activates: *mut Option<IMFActivate> = ptr::null_mut();
        let mut count: u32 = 0;
        MFTEnumEx(
            MFT_CATEGORY_VIDEO_ENCODER,
            MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
            None,
            Some(&output_type),
            &mut activates,
            &mut count,
        )?;
        let mut list = Vec::with_capacity(count as usize);
        if !activates.is_null() {
            for index in 0..count as usize {
                if let Some(activate) = (*activates.add(index)).take() {
                    list.push(activate);
                }
            }
            CoTaskMemFree(Some(activates as *const _));
        }
        Ok(list)
    }
}

fn activate_encoder(activate: IMFActivate, width: u32, height: u32, hardware: bool) -> Option<MfH264Encoder> {
    let transform: IMFTransform = unsafe { activate.ActivateObject::<IMFTransform>().ok()? };
    if unlock_if_async(&transform).is_err() {
        return None;
    }
    configure_transform(&transform, width, height)?;
    finish_encoder(transform, width, height, hardware)
}

fn unlock_if_async(transform: &IMFTransform) -> windows::core::Result<()> {
    unsafe {
        if let Ok(attributes) = transform.GetAttributes() {
            if attributes.GetUINT32(&MF_TRANSFORM_ASYNC).unwrap_or(0) == 1 {
                attributes.SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1)?;
            }
        }
    }
    Ok(())
}

fn configure_transform(transform: &IMFTransform, width: u32, height: u32) -> Option<()> {
    unsafe {
        let output = MFCreateMediaType().ok()?;
        output.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video).ok()?;
        output.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264).ok()?;
        output.SetUINT64(&MF_MT_FRAME_SIZE, pack_u32_pair(width, height)).ok()?;
        output.SetUINT64(&MF_MT_FRAME_RATE, pack_u32_pair(20, 1)).ok()?;
        output.SetUINT32(&MF_MT_AVG_BITRATE, 900_000).ok()?;
        output
            .SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)
            .ok()?;
        output
            .SetUINT32(&MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_Base.0 as u32)
            .ok()?;
        transform.SetOutputType(0, &output, 0).ok()?;

        let input = MFCreateMediaType().ok()?;
        input.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video).ok()?;
        input.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12).ok()?;
        input.SetUINT64(&MF_MT_FRAME_SIZE, pack_u32_pair(width, height)).ok()?;
        input.SetUINT64(&MF_MT_FRAME_RATE, pack_u32_pair(20, 1)).ok()?;
        input
            .SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)
            .ok()?;
        transform.SetInputType(0, &input, 0).ok()?;

        transform
            .ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)
            .ok()?;
        transform
            .ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)
            .ok()?;
    }
    Some(())
}

fn finish_encoder(transform: IMFTransform, width: u32, height: u32, hardware: bool) -> Option<MfH264Encoder> {
    let info = unsafe { transform.GetOutputStreamInfo(0).ok()? };
    let output_provides_samples = (info.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32) != 0;
    Some(MfH264Encoder {
        transform,
        width,
        height,
        frame_index: 0,
        output_provides_samples,
        output_buffer_size: info.cbSize.max(1 << 16),
        hardware,
    })
}

fn build_nv12_sample(nv12: &[u8], width: u32, height: u32, frame_index: u64) -> Option<IMFSample> {
    unsafe {
        let buffer = MFCreateMemoryBuffer(nv12.len() as u32).ok()?;
        let mut raw = ptr::null_mut();
        let mut max_length = 0u32;
        buffer.Lock(&mut raw, Some(&mut max_length), None).ok()?;
        if raw.is_null() || (max_length as usize) < nv12.len() {
            let _ = buffer.Unlock();
            return None;
        }
        ptr::copy_nonoverlapping(nv12.as_ptr(), raw, nv12.len());
        let _ = buffer.Unlock();
        buffer.SetCurrentLength(nv12.len() as u32).ok()?;
        let sample = MFCreateSample().ok()?;
        sample.AddBuffer(&buffer).ok()?;
        let time = ((frame_index as i64) * 10_000_000) / 20;
        sample.SetSampleTime(time).ok()?;
        sample.SetSampleDuration(10_000_000 / 20).ok()?;
        let _ = (width, height);
        Some(sample)
    }
}

/// 返回 Ok(true) 表示还可能有输出；Ok(false) 表示需要更多输入。
fn drain_output(
    transform: &IMFTransform,
    provides_samples: bool,
    buffer_size: u32,
    bitstream: &mut Vec<u8>,
) -> Option<bool> {
    unsafe {
        let sample = if provides_samples {
            None
        } else {
            let buffer = MFCreateMemoryBuffer(buffer_size).ok()?;
            let sample = MFCreateSample().ok()?;
            sample.AddBuffer(&buffer).ok()?;
            Some(sample)
        };
        let mut buffers = [MFT_OUTPUT_DATA_BUFFER {
            dwStreamID: 0,
            pSample: ManuallyDrop::new(sample),
            dwStatus: 0,
            pEvents: ManuallyDrop::new(None),
        }];
        let mut status = 0u32;
        let result = transform.ProcessOutput(0, &mut buffers, &mut status);
        let out_sample = ManuallyDrop::take(&mut buffers[0].pSample);
        let _events = ManuallyDrop::take(&mut buffers[0].pEvents);
        match result {
            Ok(()) => {
                if let Some(sample) = out_sample {
                    append_sample_bytes(&sample, bitstream)?;
                }
                Some(true)
            }
            Err(error) if error.code() == MF_E_TRANSFORM_NEED_MORE_INPUT => Some(false),
            Err(_) => None,
        }
    }
}

fn append_sample_bytes(sample: &IMFSample, bitstream: &mut Vec<u8>) -> Option<()> {
    unsafe {
        let buffer = sample.ConvertToContiguousBuffer().ok()?;
        let mut raw = ptr::null_mut();
        let mut current = 0u32;
        buffer.Lock(&mut raw, None, Some(&mut current)).ok()?;
        if !raw.is_null() && current > 0 {
            let slice = std::slice::from_raw_parts(raw, current as usize);
            bitstream.extend_from_slice(slice);
        }
        let _ = buffer.Unlock();
    }
    Some(())
}
