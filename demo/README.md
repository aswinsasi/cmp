# CMP Demo App

> Phone-to-phone distributed computation. No cloud. No internet.

## What This Is

A React Native app that runs the real Compute Mesh Protocol on phones. One phone submits a task, nearby phones process chunks in parallel, results are assembled and displayed — all over local Wi-Fi mesh.

## Architecture

```
App.tsx                           # Main screen (encrypt/decrypt/status)
├── hooks/
│   ├── useMesh.ts                # Real CMPNode + RNLanTransport lifecycle
│   └── useCompute.ts             # Real node.compute() with progress tracking
├── components/
│   ├── MeshTopology.tsx          # Live mesh node visualization
│   └── ComputeProgress.tsx       # Phase + chunk progress display
└── (uses)
    └── packages/transport/src/
        └── rn-lan-transport.ts   # React Native TCP/UDP transport
```

## Setup

### Prerequisites

- Node.js 20+
- React Native CLI
- Android Studio + SDK (for Android) or Xcode (for iOS)
- 2+ Android/iOS phones on the same Wi-Fi network

### Install

```bash
cd demo
npm install

# iOS only
cd ios && pod install && cd ..
```

### Required Native Permissions

**Android** (`android/app/src/main/AndroidManifest.xml`):
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
<uses-permission android:name="android.permission.CHANGE_WIFI_MULTICAST_STATE" />
```

**iOS** (`ios/Info.plist`):
```xml
<key>NSLocalNetworkUsageDescription</key>
<string>CMP needs local network access to form a compute mesh with nearby devices.</string>
<key>NSBonjourServices</key>
<array>
  <string>_cmp._udp</string>
  <string>_cmp._tcp</string>
</array>
```

### Run

```bash
# Phone 1
npx react-native run-android

# Phone 2 (connect second phone via USB, or use wireless ADB)
npx react-native run-android
```

## Usage

### Basic Flow

1. **Phone 1 & 2**: Open app → Tap "Join Mesh"
2. Wait for peer discovery (topology view shows connected peers)
3. **Phone 1**: Type a message → Tap "Encrypt"
4. Watch the mesh negotiate, distribute, execute, and assemble
5. Result shows: ciphertext, time, devices used, chunks
6. Copy ciphertext → paste on Phone 2 → Tap "Decrypt" → original text

### Hotspot Mode (no router needed)

1. Phone 1: Enable mobile hotspot
2. Phone 2: Connect to Phone 1's hotspot
3. Both: Open app → Join Mesh
4. If peers don't appear, tap "Connect" and enter the hotspot IP (usually 192.168.43.1)

### What You'll See

**Requester phone:**
```
⚡ Encrypt "Hello World"
→ Negotiating... (finds peers)
→ Distributing... (splits data)
→ Executing... (peers run WASM)
→ Complete!
  0a272e2e2d62152d302e26
  230ms • 1 device • 1 chunk
```

**Executor phone:**
```
💰 Earned 1 CCU  balance: 101
```

## How It Works

1. **Discovery**: UDP multicast beacons on port 43580 (same as CLI)
2. **Handshake**: X25519 key exchange over TCP
3. **Negotiation**: Task request → bid → scoring → assignment
4. **Execution**: WASM module + encrypted data sent via TCP to executor
5. **Assembly**: Encrypted results returned, decrypted, merged by requester

The WASM module is a 104-byte XOR cipher (same one used in CLI tests). It XORs each byte with 0x42 — encrypt twice = decrypt. Simple but proves real distributed WASM execution.

## Credits & Reputation

- Start with 100 CCU (Compute Credit Units)
- Spend 1 CCU per chunk submitted
- Earn 1 CCU per chunk executed for others
- Reputation tracks completion rate, accuracy, availability, honesty
- Below 500 reputation = excluded from mesh

## Transport Layer

`RNLanTransport` (in `packages/transport/src/rn-lan-transport.ts`) is a drop-in replacement for the Node.js `LANTransport`:

| Node.js (CLI) | React Native (App) |
|---|---|
| `dgram` (UDP) | `react-native-udp` |
| `net` (TCP) | `react-native-tcp-socket` |

Same wire format, same port, same protocol. A CLI node and an RN app node can join the same mesh.

---

*Agent Viscro — CMP v1.4*
