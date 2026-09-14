#!/bin/sh
# Builds windowcapture next to this script. Needs wayland-scanner, libpng.
set -eu
cd "$(dirname "$0")"
wayland-scanner client-header hyprland-toplevel-export-v1.xml hyprland-toplevel-export-v1-client.h
wayland-scanner private-code hyprland-toplevel-export-v1.xml hyprland-toplevel-export-v1-protocol.c
cc -O2 -Wall -Wextra -o windowcapture windowcapture.c hyprland-toplevel-export-v1-protocol.c \
  $(pkg-config --cflags --libs wayland-client libpng)
