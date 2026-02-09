# Linux Installation & Building Guide

This guide covers Linux-specific installation options and building from source.

## Flatpak Installation

Flatpak packages are available for Linux users who prefer sandboxed applications.

### Download Flatpak

See the [main README](../README.md#beta-release) for Flatpak download links in the Beta Release section.

### Building Flatpak from Source

To build the Flatpak package yourself, you need additional dependencies:

```bash
# Fedora/RHEL
sudo dnf install flatpak-builder

# Ubuntu/Debian
sudo apt install flatpak-builder

# Install required Flatpak runtimes
flatpak install flathub org.freedesktop.Platform//25.08 org.freedesktop.Sdk//25.08
flatpak install flathub org.electronjs.Electron2.BaseApp//25.08

# Build the Flatpak
cd apps/frontend
npm run package:flatpak
```

The Flatpak will be created in `apps/frontend/dist/`.

### Installing the Built Flatpak

After building, install the Flatpak locally:

```bash
flatpak install --user apps/frontend/dist/AC-Jerry-*.flatpak
```

### Running from Flatpak

```bash
flatpak run com.acjerry.ACJerry
```

## Other Linux Packages

### AppImage

AppImage files are portable and don't require installation:

```bash
# Make executable
chmod +x AC-Jerry-*-linux-x86_64.AppImage

# Run
./AC-Jerry-*-linux-x86_64.AppImage
```

### Debian Package (.deb)

For Ubuntu/Debian systems:

```bash
sudo dpkg -i AC-Jerry-*-linux-amd64.deb
```

## Troubleshooting

### Flatpak Runtime Issues

If you encounter runtime issues with Flatpak:

```bash
# Update runtimes
flatpak update

# Check for missing runtimes
flatpak list --runtime
```

### AppImage Not Starting

If the AppImage doesn't start:

```bash
# Check for missing libraries
ldd ./AC-Jerry-*-linux-x86_64.AppImage

# Try running with debug output
./AC-Jerry-*-linux-x86_64.AppImage --verbose
```
