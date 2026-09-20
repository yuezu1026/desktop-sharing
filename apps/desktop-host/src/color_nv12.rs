//! BGR24 → NV12。纯函数，方便单测；MF 输入要 NV12。

/// 宽高须为偶数。输出：Y 平面紧接交错 UV。
pub fn bgr_to_nv12(bgr: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    if width < 2 || height < 2 || width % 2 != 0 || height % 2 != 0 {
        return None;
    }
    let width_usize = width as usize;
    let height_usize = height as usize;
    let expected = width_usize * height_usize * 3;
    if bgr.len() < expected {
        return None;
    }
    let mut nv12 = vec![0u8; width_usize * height_usize + width_usize * height_usize / 2];
    for row in 0..height_usize {
        for column in 0..width_usize {
            let index = (row * width_usize + column) * 3;
            let blue = bgr[index] as i32;
            let green = bgr[index + 1] as i32;
            let red = bgr[index + 2] as i32;
            let luma = ((66 * red + 129 * green + 25 * blue + 128) >> 8) + 16;
            nv12[row * width_usize + column] = luma.clamp(0, 255) as u8;
        }
    }
    let uv_base = width_usize * height_usize;
    for row in (0..height_usize).step_by(2) {
        for column in (0..width_usize).step_by(2) {
            let mut sum_u = 0i32;
            let mut sum_v = 0i32;
            for offset_row in 0..2 {
                for offset_column in 0..2 {
                    let index = ((row + offset_row) * width_usize + column + offset_column) * 3;
                    let blue = bgr[index] as i32;
                    let green = bgr[index + 1] as i32;
                    let red = bgr[index + 2] as i32;
                    sum_u += ((-38 * red - 74 * green + 112 * blue + 128) >> 8) + 128;
                    sum_v += ((112 * red - 94 * green - 18 * blue + 128) >> 8) + 128;
                }
            }
            let uv_index = uv_base + (row / 2) * width_usize + column;
            nv12[uv_index] = (sum_u / 4).clamp(0, 255) as u8;
            nv12[uv_index + 1] = (sum_v / 4).clamp(0, 255) as u8;
        }
    }
    Some(nv12)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_odd_size() {
        assert!(bgr_to_nv12(&[0; 12], 2, 1).is_none());
    }

    #[test]
    fn solid_blue_fills_y_and_uv_planes() {
        let width = 4u32;
        let height = 4u32;
        let mut bgr = vec![0u8; (width * height * 3) as usize];
        for pixel in bgr.chunks_exact_mut(3) {
            pixel[0] = 255;
            pixel[1] = 0;
            pixel[2] = 0;
        }
        let nv12 = bgr_to_nv12(&bgr, width, height).expect("nv12");
        assert_eq!(nv12.len(), (width * height + width * height / 2) as usize);
        // 纯蓝的 Y 应明显低于 128
        assert!(nv12[0] < 100);
    }
}
