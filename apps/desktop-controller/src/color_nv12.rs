//! NV12 → BGR24。纯函数，供 MF 硬解输出转换单测。

pub fn nv12_to_bgr(nv12: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    if width < 2 || height < 2 || width % 2 != 0 || height % 2 != 0 {
        return None;
    }
    let width_usize = width as usize;
    let height_usize = height as usize;
    let y_size = width_usize * height_usize;
    let needed = y_size + y_size / 2;
    if nv12.len() < needed {
        return None;
    }
    let mut bgr = vec![0u8; y_size * 3];
    for row in 0..height_usize {
        for column in 0..width_usize {
            let luma = nv12[row * width_usize + column] as i32;
            let uv_index = y_size + (row / 2) * width_usize + (column & !1);
            let chroma_u = nv12[uv_index] as i32;
            let chroma_v = nv12[uv_index + 1] as i32;
            let c = luma - 16;
            let d = chroma_u - 128;
            let e = chroma_v - 128;
            let red = ((298 * c + 409 * e + 128) >> 8).clamp(0, 255) as u8;
            let green = ((298 * c - 100 * d - 208 * e + 128) >> 8).clamp(0, 255) as u8;
            let blue = ((298 * c + 516 * d + 128) >> 8).clamp(0, 255) as u8;
            let index = (row * width_usize + column) * 3;
            bgr[index] = blue;
            bgr[index + 1] = green;
            bgr[index + 2] = red;
        }
    }
    Some(bgr)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_odd_size() {
        assert!(nv12_to_bgr(&[0u8; 8], 3, 2).is_none());
    }

    #[test]
    fn mid_gray_fills_bgr() {
        let width = 4u32;
        let height = 2u32;
        let y_size = (width * height) as usize;
        let mut nv12 = vec![16u8; y_size];
        nv12.extend(std::iter::repeat(128u8).take(y_size / 2));
        let bgr = nv12_to_bgr(&nv12, width, height).expect("bgr");
        assert_eq!(bgr.len(), y_size * 3);
        assert!(bgr.iter().all(|value| *value <= 2));
    }
}
