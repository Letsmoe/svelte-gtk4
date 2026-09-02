//! Wallpaper image: decode, cover-scale to an output, and sample the strip the
//! bar sits over into gradient stops.

use std::path::Path;

use image::imageops::FilterType;
use image::{DynamicImage, RgbaImage};

/// A decoded wallpaper, kept at full resolution so it can be re-scaled for each
/// output and re-sampled when the bar geometry changes.
pub struct Wallpaper {
    image: DynamicImage,
}

impl Wallpaper {
    pub fn load(path: &Path) -> Result<Self, String> {
        let image = image::open(path).map_err(|err| format!("decode {}: {err}", path.display()))?;
        Ok(Self { image })
    }

    /// Scale to cover `width` × `height` (preserve aspect, center-crop the
    /// overflow), returning RGBA pixels. Lanczos3 because this runs rarely.
    pub fn render(&self, width: u32, height: u32) -> RgbaImage {
        self.image
            .resize_to_fill(width, height, FilterType::Lanczos3)
            .to_rgba8()
    }
}

/// Copy an RGBA image into a BGRA (`wl_shm` Argb8888 little-endian) canvas of the
/// same dimensions, forcing every pixel opaque.
pub fn copy_to_bgra(rgba: &RgbaImage, canvas: &mut [u8]) {
    for (source, destination) in rgba.chunks_exact(4).zip(canvas.chunks_exact_mut(4)) {
        destination[0] = source[2]; // B
        destination[1] = source[1]; // G
        destination[2] = source[0]; // R
        destination[3] = 255; // A
    }
}

/// Average the top `bar_height` rows of `rgba` into `segments` left-to-right
/// color stops. These approximate a blurred view of the wallpaper behind the
/// bar; the frontend interpolates them into a gradient.
pub fn sample_strip(rgba: &RgbaImage, bar_height: u32, segments: usize) -> Vec<[u8; 3]> {
    let width = rgba.width();
    let height = rgba.height();
    if width == 0 || height == 0 || segments == 0 {
        return Vec::new();
    }

    let rows = bar_height.min(height);
    let mut stops = Vec::with_capacity(segments);
    for segment in 0..segments {
        let start = (segment as u32 * width) / segments as u32;
        let end = ((segment as u32 + 1) * width) / segments as u32;
        stops.push(average_region(rgba, start, end.max(start + 1), rows));
    }
    stops
}

/// Mean RGB over the rectangle cols `[start, end)` × rows `[0, rows)`.
fn average_region(rgba: &RgbaImage, start: u32, end: u32, rows: u32) -> [u8; 3] {
    let mut sum = [0u64; 3];
    let mut count = 0u64;
    for y in 0..rows {
        for x in start..end {
            let pixel = rgba.get_pixel(x, y).0;
            sum[0] += pixel[0] as u64;
            sum[1] += pixel[1] as u64;
            sum[2] += pixel[2] as u64;
            count += 1;
        }
    }
    if count == 0 {
        return [0, 0, 0];
    }
    [
        (sum[0] / count) as u8,
        (sum[1] / count) as u8,
        (sum[2] / count) as u8,
    ]
}
