//! DXGI 桌面复制。会话进行中才打开；丢权限或模式变化时重建，失败由上层回退 GDI。

use windows::core::Interface;
use windows::Win32::Foundation::HMODULE;
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL_11_0};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_CPU_ACCESS_READ,
    D3D11_CREATE_DEVICE_FLAG, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_SDK_VERSION,
    D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIFactory1, IDXGIOutput1, IDXGIOutputDuplication, IDXGIResource,
    DXGI_ERROR_ACCESS_LOST, DXGI_ERROR_WAIT_TIMEOUT, DXGI_OUTDUPL_FRAME_INFO,
};

pub struct DxgiGrabber {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    duplication: IDXGIOutputDuplication,
    staging: Option<ID3D11Texture2D>,
    desktop_width: u32,
    desktop_height: u32,
}

impl DxgiGrabber {
    pub fn open() -> Option<Self> {
        unsafe {
            let mut device: Option<ID3D11Device> = None;
            let mut context: Option<ID3D11DeviceContext> = None;
            let levels = [D3D_FEATURE_LEVEL_11_0];
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_FLAG(0),
                Some(&levels),
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )
            .ok()?;
            let device = device?;
            let context = context?;
            let factory: IDXGIFactory1 = CreateDXGIFactory1().ok()?;
            let adapter = factory.EnumAdapters1(0).ok()?;
            let output = adapter.EnumOutputs(0).ok()?;
            let output1: IDXGIOutput1 = output.cast().ok()?;
            let duplication = output1.DuplicateOutput(&device).ok()?;
            let desc = duplication.GetDesc();
            Some(Self {
                device,
                context,
                duplication,
                staging: None,
                desktop_width: desc.ModeDesc.Width.max(1),
                desktop_height: desc.ModeDesc.Height.max(1),
            })
        }
    }

    /// 超时表示画面未变，返回 None；丢权限返回 Err 让上层重建或回退。
    pub fn grab_bgr_scaled(&mut self, max_width: i32) -> Result<Option<(i32, i32, Vec<u8>)>, ()> {
        unsafe {
            let mut frame_info = DXGI_OUTDUPL_FRAME_INFO::default();
            let mut resource: Option<IDXGIResource> = None;
            match self.duplication.AcquireNextFrame(16, &mut frame_info, &mut resource) {
                Ok(()) => {}
                Err(error) if error.code() == DXGI_ERROR_WAIT_TIMEOUT => return Ok(None),
                Err(error) if error.code() == DXGI_ERROR_ACCESS_LOST => return Err(()),
                Err(_) => return Err(()),
            }
            let Some(resource) = resource else {
                let _ = self.duplication.ReleaseFrame();
                return Ok(None);
            };
            let texture: ID3D11Texture2D = match resource.cast() {
                Ok(value) => value,
                Err(_) => {
                    let _ = self.duplication.ReleaseFrame();
                    return Err(());
                }
            };
            if self.staging.is_none() {
                self.staging = create_staging(&self.device, self.desktop_width, self.desktop_height);
            }
            let Some(staging) = self.staging.as_ref() else {
                let _ = self.duplication.ReleaseFrame();
                return Err(());
            };
            self.context.CopyResource(staging, &texture);
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            if self.context.Map(staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)).is_err() {
                let _ = self.duplication.ReleaseFrame();
                return Err(());
            }
            let pitch = mapped.RowPitch as usize;
            let source = std::slice::from_raw_parts(
                mapped.pData as *const u8,
                pitch * self.desktop_height as usize,
            );
            let full = bgra_rows_to_bgr(source, pitch, self.desktop_width, self.desktop_height);
            self.context.Unmap(staging, 0);
            let _ = self.duplication.ReleaseFrame();
            Ok(Some(scale_bgr(
                &full,
                self.desktop_width as i32,
                self.desktop_height as i32,
                max_width,
            )))
        }
    }
}

unsafe fn create_staging(device: &ID3D11Device, width: u32, height: u32) -> Option<ID3D11Texture2D> {
    let desc = D3D11_TEXTURE2D_DESC {
        Width: width,
        Height: height,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_STAGING,
        BindFlags: 0,
        CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
        MiscFlags: 0,
    };
    let mut texture = None;
    device.CreateTexture2D(&desc, None, Some(&mut texture)).ok()?;
    texture
}

fn bgra_rows_to_bgr(source: &[u8], pitch: usize, width: u32, height: u32) -> Vec<u8> {
    let mut bgr = Vec::with_capacity((width * height * 3) as usize);
    for row in 0..height as usize {
        let start = row * pitch;
        let row_bytes = &source[start..start + width as usize * 4];
        for pixel in row_bytes.chunks_exact(4) {
            bgr.push(pixel[0]);
            bgr.push(pixel[1]);
            bgr.push(pixel[2]);
        }
    }
    bgr
}

fn scale_bgr(source: &[u8], width: i32, height: i32, max_width: i32) -> (i32, i32, Vec<u8>) {
    let target_width = width.min(max_width).max(1);
    let target_height = ((height as i64 * target_width as i64) / width as i64).max(1) as i32;
    if target_width == width && target_height == height {
        return (width, height, source.to_vec());
    }
    let mut scaled = vec![0u8; (target_width * target_height * 3) as usize];
    for target_y in 0..target_height {
        let source_y = target_y * height / target_height;
        for target_x in 0..target_width {
            let source_x = target_x * width / target_width;
            let source_index = ((source_y * width + source_x) * 3) as usize;
            let target_index = ((target_y * target_width + target_x) * 3) as usize;
            scaled[target_index..target_index + 3].copy_from_slice(&source[source_index..source_index + 3]);
        }
    }
    (target_width, target_height, scaled)
}
