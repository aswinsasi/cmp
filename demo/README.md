# CMP Demo App

> 5 phones. No internet. Distributed AI inference in 3 seconds.

## What This Is

A React Native app that demonstrates the Compute Mesh Protocol on real devices. One phone submits a task, nearby phones process chunks in parallel, results are assembled and displayed — all without cloud or internet.

## Setup

### Prerequisites

- Node.js 20+
- React Native CLI (`npm install -g react-native`)
- Android Studio + SDK (for Android)
- 2-5 Android phones (Android 10+)
- All phones on the same Wi-Fi network (for LAN transport)

### Install

```bash
cd demo
npm install
```

### Run on Device

```bash
# Connect phone via USB
npx react-native run-android

# Repeat for each phone
```

### Demo Flow

**Phone 1 (Requester):**
1. Open app → Select "Requester" mode
2. Tap "Join Mesh"
3. Wait for peers to appear in topology view
4. Tap "Analyze with Mesh"
5. Watch chunks distribute and results assemble

**Phones 2-5 (Executors):**
1. Open app → Select "Executor" mode
2. Tap "Join Mesh"
3. Wait for "Waiting for tasks..." state
4. Chunks arrive and process automatically

## Architecture

```
App.tsx                    # Main screen
├── hooks/
│   ├── useMesh.ts         # CMP node lifecycle + mesh state
│   └── useCompute.ts      # Distributed computation + progress
└── components/
    ├── MeshTopology.tsx    # Live mesh node visualization
    └── ComputeProgress.tsx # Phase + chunk progress display
```

## For the Video

1. Place 5 phones on a table
2. Enable airplane mode on all (proves no internet)
3. Connect all to same Wi-Fi (for LAN transport) OR use Wi-Fi Direct
4. Start Executor mode on phones 2-5 first
5. Start Requester mode on phone 1
6. Wait for all peers to appear in topology
7. Tap "Analyze with Mesh"
8. Record overhead shot of all 5 screens

## Colors & Design

Dark theme optimized for camera visibility:
- Background: `#020617` (near black)
- Primary: `#3B82F6` (blue)
- Success: `#10B981` (green)
- Active: `#F59E0B` (amber)
- Text: `#E2E8F0` (light gray)

---

*Agent Viscro — CMP v1.0*
