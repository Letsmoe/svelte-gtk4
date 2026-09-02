// Turning an item's icon into something a webview can render. The shell draws
// either a freedesktop icon name, which the host resolves at /appicon/<name>,
// or a data URL built here for the applications that ship no themed icon at
// all. An item carrying IconThemePath is the awkward middle case: the name is
// real but only resolvable inside the application's own directory, so the file
// is read and inlined.
package main

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/png"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/godbus/dbus/v5"
)

const (
	statusNeedsAttention = "NeedsAttention"
	// Icons below this are upscaled blurry in the bar; the smallest pixmap at
	// or above it is the cheapest one that still looks right.
	preferredPixelSize = 32
)

// pixmap is one entry of the item's IconPixmap property: ARGB32 pixels in
// network byte order.
type pixmap struct {
	Width  int32
	Height int32
	Data   []byte
}

func resolveIcon(properties map[string]dbus.Variant, status string) (string, string) {
	name := iconNameFor(properties, status)
	if name == "" {
		return "", inlinePixmap(properties, status)
	}
	data := inlineThemeIcon(stringProperty(properties, "IconThemePath"), name)
	if data != "" {
		return "", data
	}
	return name, ""
}

func iconNameFor(properties map[string]dbus.Variant, status string) string {
	if status == statusNeedsAttention {
		attention := stringProperty(properties, "AttentionIconName")
		if attention != "" {
			return attention
		}
	}
	return stringProperty(properties, "IconName")
}

func inlinePixmap(properties map[string]dbus.Variant, status string) string {
	best := selectPixmap(pixmapsFor(properties, status))
	if best == nil {
		return ""
	}
	return pngDataURL(*best)
}

func pixmapsFor(properties map[string]dbus.Variant, status string) []pixmap {
	if status == statusNeedsAttention {
		attention := pixmapProperty(properties, "AttentionIconPixmap")
		if len(attention) > 0 {
			return attention
		}
	}
	return pixmapProperty(properties, "IconPixmap")
}

func pixmapProperty(properties map[string]dbus.Variant, name string) []pixmap {
	variant, exists := properties[name]
	if !exists {
		return nil
	}
	var pixmaps []pixmap
	if variant.Store(&pixmaps) != nil {
		return nil
	}
	return pixmaps
}

// An item offers its icon at several sizes. The smallest one big enough for
// the bar wins; if every pixmap is smaller than that, the largest is the least
// bad upscale.
func selectPixmap(pixmaps []pixmap) *pixmap {
	var best *pixmap
	for index := range pixmaps {
		best = betterPixmap(best, &pixmaps[index])
	}
	return best
}

func betterPixmap(best *pixmap, candidate *pixmap) *pixmap {
	if !candidate.usable() {
		return best
	}
	if best == nil {
		return candidate
	}
	if best.Width < preferredPixelSize {
		return largerOf(best, candidate)
	}
	if candidate.Width >= preferredPixelSize && candidate.Width < best.Width {
		return candidate
	}
	return best
}

func largerOf(best *pixmap, candidate *pixmap) *pixmap {
	if candidate.Width > best.Width {
		return candidate
	}
	return best
}

func (p pixmap) usable() bool {
	if p.Width <= 0 || p.Height <= 0 {
		return false
	}
	return len(p.Data) >= int(p.Width)*int(p.Height)*4
}

// The wire format is ARGB, the encoder wants RGBA, and both are
// straight-alpha, so the conversion is a channel rotation per pixel.
func pngDataURL(source pixmap) string {
	target := image.NewNRGBA(image.Rect(0, 0, int(source.Width), int(source.Height)))
	for offset := 0; offset+3 < len(target.Pix); offset += 4 {
		target.Pix[offset] = source.Data[offset+1]
		target.Pix[offset+1] = source.Data[offset+2]
		target.Pix[offset+2] = source.Data[offset+3]
		target.Pix[offset+3] = source.Data[offset]
	}
	encoded := bytes.Buffer{}
	if png.Encode(&encoded, target) != nil {
		return ""
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(encoded.Bytes())
}

func inlineThemeIcon(themePath string, name string) string {
	if themePath == "" || name == "" {
		return ""
	}
	path := findThemeIcon(themePath, name)
	if path == "" {
		return ""
	}
	return fileDataURL(path)
}

// The theme path is an ordinary icon tree, so the file sits at an unknown
// depth under a size or category directory.
func findThemeIcon(themePath string, name string) string {
	found := ""
	_ = filepath.WalkDir(themePath, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() || !matchesIconName(entry.Name(), name) {
			return nil
		}
		found = preferredIconPath(found, path)
		return nil
	})
	return found
}

func matchesIconName(fileName string, name string) bool {
	extension := filepath.Ext(fileName)
	if extension != ".png" && extension != ".svg" {
		return false
	}
	return strings.TrimSuffix(fileName, extension) == name
}

// A raster icon is already at a real size; the SVG is only taken when nothing
// else was found.
func preferredIconPath(found string, candidate string) string {
	if found == "" {
		return candidate
	}
	if filepath.Ext(found) == ".svg" && filepath.Ext(candidate) == ".png" {
		return candidate
	}
	return found
}

func fileDataURL(path string) string {
	content, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return "data:" + mimeOf(path) + ";base64," + base64.StdEncoding.EncodeToString(content)
}

func mimeOf(path string) string {
	if filepath.Ext(path) == ".svg" {
		return "image/svg+xml"
	}
	return "image/png"
}
