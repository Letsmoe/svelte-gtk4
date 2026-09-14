// windowcapture: grab one frame of a Hyprland window through
// hyprland-toplevel-export-v1 and write it as a PNG.
//
//   windowcapture <address> <output.png> [max-width]
//
// <address> is the window address as printed by `hyprctl clients` (with or
// without the 0x prefix). The frame is the window's own content: occluded
// windows and windows on hidden workspaces capture fine, which is what a
// screen-region grab cannot do. With [max-width] the image is box-filtered
// down by an integer factor so it is at most that wide.

#include <errno.h>
#include <fcntl.h>
#include <png.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>
#include <wayland-client.h>

#include "hyprland-toplevel-export-v1-client.h"

// Version 2 of the manager can also capture through a wlr foreign-toplevel
// handle; the generated code references that interface even though version 1
// is all that is bound here.
const struct wl_interface zwlr_foreign_toplevel_handle_v1_interface = {
    "zwlr_foreign_toplevel_handle_v1", 3, 0, NULL, 0, NULL,
};

struct capture {
  struct wl_shm *shm;
  struct hyprland_toplevel_export_manager_v1 *manager;
  struct hyprland_toplevel_export_frame_v1 *frame;
  struct wl_buffer *buffer;
  uint32_t format;
  uint32_t width;
  uint32_t height;
  uint32_t stride;
  uint32_t flags;
  uint8_t *pixels;
  size_t size;
  int shm_offered;
  int done;
  int failed;
};

static void registry_global(void *data, struct wl_registry *registry, uint32_t name,
                            const char *interface, uint32_t version) {
  struct capture *capture = data;
  if (strcmp(interface, wl_shm_interface.name) == 0) {
    capture->shm = wl_registry_bind(registry, name, &wl_shm_interface, 1);
    return;
  }
  if (strcmp(interface, hyprland_toplevel_export_manager_v1_interface.name) == 0) {
    (void)version;
    capture->manager =
        wl_registry_bind(registry, name, &hyprland_toplevel_export_manager_v1_interface, 1);
  }
}

static void registry_global_remove(void *data, struct wl_registry *registry, uint32_t name) {
  (void)data;
  (void)registry;
  (void)name;
}

static const struct wl_registry_listener registry_listener = {
    .global = registry_global,
    .global_remove = registry_global_remove,
};

static int create_shm_file(size_t size) {
  char name[] = "/neoshell-windowcapture-XXXXXX";
  int fd = -1;
  for (int attempt = 0; attempt < 100 && fd < 0; attempt++) {
    snprintf(name, sizeof name, "/neoshell-windowcapture-%d-%d", getpid(), attempt);
    fd = shm_open(name, O_RDWR | O_CREAT | O_EXCL, 0600);
    if (fd >= 0) {
      shm_unlink(name);
    }
  }
  if (fd < 0) {
    return -1;
  }
  if (ftruncate(fd, (off_t)size) < 0) {
    close(fd);
    return -1;
  }
  return fd;
}

static void frame_buffer(void *data, struct hyprland_toplevel_export_frame_v1 *frame,
                         uint32_t format, uint32_t width, uint32_t height, uint32_t stride) {
  (void)frame;
  struct capture *capture = data;
  capture->format = format;
  capture->width = width;
  capture->height = height;
  capture->stride = stride;
  capture->shm_offered = 1;
}

static void frame_damage(void *data, struct hyprland_toplevel_export_frame_v1 *frame, uint32_t x,
                         uint32_t y, uint32_t width, uint32_t height) {
  (void)data;
  (void)frame;
  (void)x;
  (void)y;
  (void)width;
  (void)height;
}

static void frame_flags(void *data, struct hyprland_toplevel_export_frame_v1 *frame,
                        uint32_t flags) {
  (void)frame;
  struct capture *capture = data;
  capture->flags = flags;
}

static void frame_ready(void *data, struct hyprland_toplevel_export_frame_v1 *frame,
                        uint32_t tv_sec_hi, uint32_t tv_sec_lo, uint32_t tv_nsec) {
  (void)frame;
  (void)tv_sec_hi;
  (void)tv_sec_lo;
  (void)tv_nsec;
  struct capture *capture = data;
  capture->done = 1;
}

static void frame_failed(void *data, struct hyprland_toplevel_export_frame_v1 *frame) {
  (void)frame;
  struct capture *capture = data;
  capture->failed = 1;
  capture->done = 1;
}

static void frame_linux_dmabuf(void *data, struct hyprland_toplevel_export_frame_v1 *frame,
                               uint32_t format, uint32_t width, uint32_t height) {
  (void)data;
  (void)frame;
  (void)format;
  (void)width;
  (void)height;
}

// buffer_done is where the compositor has listed every buffer type it takes;
// a wl_shm buffer of the announced size is created and the copy requested.
static void frame_buffer_done(void *data, struct hyprland_toplevel_export_frame_v1 *frame) {
  struct capture *capture = data;
  if (!capture->shm_offered) {
    fprintf(stderr, "windowcapture: compositor offers no wl_shm buffer\n");
    capture->failed = 1;
    capture->done = 1;
    return;
  }
  capture->size = (size_t)capture->stride * capture->height;
  int fd = create_shm_file(capture->size);
  if (fd < 0) {
    fprintf(stderr, "windowcapture: shm: %s\n", strerror(errno));
    capture->failed = 1;
    capture->done = 1;
    return;
  }
  capture->pixels = mmap(NULL, capture->size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  if (capture->pixels == MAP_FAILED) {
    fprintf(stderr, "windowcapture: mmap: %s\n", strerror(errno));
    close(fd);
    capture->failed = 1;
    capture->done = 1;
    return;
  }
  struct wl_shm_pool *pool = wl_shm_create_pool(capture->shm, fd, (int32_t)capture->size);
  capture->buffer = wl_shm_pool_create_buffer(pool, 0, (int32_t)capture->width,
                                              (int32_t)capture->height, (int32_t)capture->stride,
                                              capture->format);
  wl_shm_pool_destroy(pool);
  close(fd);
  hyprland_toplevel_export_frame_v1_copy(frame, capture->buffer, 1);
}

static const struct hyprland_toplevel_export_frame_v1_listener frame_listener = {
    .buffer = frame_buffer,
    .damage = frame_damage,
    .flags = frame_flags,
    .ready = frame_ready,
    .failed = frame_failed,
    .linux_dmabuf = frame_linux_dmabuf,
    .buffer_done = frame_buffer_done,
};

// pixel_rgba reads one source pixel as R, G, B, A regardless of the wl_shm
// layout. All four supported formats are 32-bit little-endian words.
static void pixel_rgba(const struct capture *capture, uint32_t x, uint32_t y, uint8_t out[4]) {
  uint32_t row = y;
  if (capture->flags & HYPRLAND_TOPLEVEL_EXPORT_FRAME_V1_FLAGS_Y_INVERT) {
    row = capture->height - 1 - y;
  }
  const uint8_t *p = capture->pixels + (size_t)row * capture->stride + (size_t)x * 4;
  switch (capture->format) {
  case WL_SHM_FORMAT_ARGB8888:
    out[0] = p[2];
    out[1] = p[1];
    out[2] = p[0];
    out[3] = p[3];
    return;
  case WL_SHM_FORMAT_XRGB8888:
    out[0] = p[2];
    out[1] = p[1];
    out[2] = p[0];
    out[3] = 255;
    return;
  case WL_SHM_FORMAT_ABGR8888:
    out[0] = p[0];
    out[1] = p[1];
    out[2] = p[2];
    out[3] = p[3];
    return;
  case WL_SHM_FORMAT_XBGR8888:
    out[0] = p[0];
    out[1] = p[1];
    out[2] = p[2];
    out[3] = 255;
    return;
  default:
    out[0] = p[2];
    out[1] = p[1];
    out[2] = p[0];
    out[3] = 255;
  }
}

static int write_png(const struct capture *capture, const char *path, uint32_t max_width) {
  FILE *file = fopen(path, "wb");
  if (file == NULL) {
    fprintf(stderr, "windowcapture: %s: %s\n", path, strerror(errno));
    return -1;
  }
  png_structp png = png_create_write_struct(PNG_LIBPNG_VER_STRING, NULL, NULL, NULL);
  png_infop info = png_create_info_struct(png);
  uint8_t *volatile row = NULL;
  if (png == NULL || info == NULL || setjmp(png_jmpbuf(png))) {
    fprintf(stderr, "windowcapture: png encoding failed\n");
    fclose(file);
    free(row);
    return -1;
  }

  uint32_t factor = 1;
  if (max_width > 0 && capture->width > max_width) {
    factor = (capture->width + max_width - 1) / max_width;
  }
  uint32_t out_width = capture->width / factor;
  uint32_t out_height = capture->height / factor;
  if (out_width == 0 || out_height == 0) {
    fprintf(stderr, "windowcapture: frame too small\n");
    fclose(file);
    return -1;
  }
  row = malloc((size_t)out_width * 4);
  if (row == NULL) {
    fclose(file);
    return -1;
  }
  png_init_io(png, file);
  png_set_IHDR(png, info, out_width, out_height, 8, PNG_COLOR_TYPE_RGBA, PNG_INTERLACE_NONE,
               PNG_COMPRESSION_TYPE_DEFAULT, PNG_FILTER_TYPE_DEFAULT);
  png_set_compression_level(png, 1);
  png_write_info(png, info);

  uint32_t samples = factor * factor;
  for (uint32_t y = 0; y < out_height; y++) {
    for (uint32_t x = 0; x < out_width; x++) {
      uint32_t sum[4] = {0, 0, 0, 0};
      for (uint32_t dy = 0; dy < factor; dy++) {
        for (uint32_t dx = 0; dx < factor; dx++) {
          uint8_t rgba[4];
          pixel_rgba(capture, x * factor + dx, y * factor + dy, rgba);
          for (int c = 0; c < 4; c++) {
            sum[c] += rgba[c];
          }
        }
      }
      for (int c = 0; c < 4; c++) {
        row[x * 4 + c] = (uint8_t)(sum[c] / samples);
      }
    }
    png_write_row(png, row);
  }
  png_write_end(png, NULL);
  png_destroy_write_struct(&png, &info);
  free(row);
  fclose(file);
  return 0;
}

int main(int argc, char **argv) {
  if (argc < 3 || argc > 4) {
    fprintf(stderr, "usage: windowcapture <address> <output.png> [max-width]\n");
    return 2;
  }
  // The protocol takes the low 32 bits of the window address.
  uint64_t address = strtoull(argv[1], NULL, 16);
  uint32_t handle = (uint32_t)address;
  uint32_t max_width = 0;
  if (argc == 4) {
    max_width = (uint32_t)strtoul(argv[3], NULL, 10);
  }

  struct wl_display *display = wl_display_connect(NULL);
  if (display == NULL) {
    fprintf(stderr, "windowcapture: cannot connect to the Wayland display\n");
    return 1;
  }
  struct capture capture = {0};
  struct wl_registry *registry = wl_display_get_registry(display);
  wl_registry_add_listener(registry, &registry_listener, &capture);
  wl_display_roundtrip(display);
  if (capture.shm == NULL || capture.manager == NULL) {
    fprintf(stderr, "windowcapture: compositor lacks wl_shm or hyprland_toplevel_export_v1\n");
    return 1;
  }

  capture.frame = hyprland_toplevel_export_manager_v1_capture_toplevel(capture.manager, 0, handle);
  hyprland_toplevel_export_frame_v1_add_listener(capture.frame, &frame_listener, &capture);
  while (!capture.done && wl_display_dispatch(display) != -1) {
  }
  if (capture.failed) {
    fprintf(stderr, "windowcapture: the compositor could not capture %s\n", argv[1]);
    return 1;
  }
  int status = write_png(&capture, argv[2], max_width);

  hyprland_toplevel_export_frame_v1_destroy(capture.frame);
  wl_buffer_destroy(capture.buffer);
  munmap(capture.pixels, capture.size);
  hyprland_toplevel_export_manager_v1_destroy(capture.manager);
  wl_shm_destroy(capture.shm);
  wl_registry_destroy(registry);
  wl_display_disconnect(display);
  return status == 0 ? 0 : 1;
}
