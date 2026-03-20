# CMP Launch Posts — Agent Viscro

## ═══════════════════════════════════════════════
## 1. SHOW HN POST (Hacker News)
## ═══════════════════════════════════════════════

### Title:
Show HN: CMP – Turn nearby devices into a supercomputer, no cloud, no internet

### URL:
https://github.com/agentviscro/compute-mesh-protocol

### Text:

I built an open protocol that lets nearby devices discover each other over LAN/Wi-Fi and distribute computation across them — with zero servers, zero cloud, zero internet.

CMP (Compute Mesh Protocol) is a 6-layer stack: Discovery → Capability Exchange → Negotiation → Distribution → Execution → Assembly.

How it works:
- Devices broadcast UDP beacons on the local network
- ECDH handshake establishes encrypted sessions (X25519)
- Each device advertises its CPU, memory, GPU capabilities
- When you submit a task, peers bid on it with their available resources
- Bids are scored (resource fit, speed, reputation, power stability)
- Winner executes the task in a WASM sandbox — zero filesystem/network access
- Result flows back encrypted

What you can try right now (two terminals, same machine):

    Terminal 1: npx tsx src/cli.ts start
    Terminal 2: npx tsx src/cli.ts start
    # Wait for "Handshake complete"
    Terminal 1: encrypt Hello World

Terminal 2 runs a real WASM XOR cipher on the data and sends the ciphertext back. You can decrypt it too.

The reference implementation is TypeScript, 10K+ lines, 150 tests. All 6 protocol layers are functional.

Real use cases I'm targeting: edge AI inference without cloud (rural clinics, disaster response), privacy-preserving computation (data never leaves the room), and computational equity for the developing world — billions of phones with idle CPUs that could collectively run AI models.

I'm one developer from Kerala, India. Built this because I believe the compute is already there — there's just no protocol to use it collectively.

Known limitations:
- WASM sandbox overhead vs native (~15%)
- Not useful for tasks under 500ms (coordination cost exceeds benefit)
- iOS background execution limits restrict long mesh participation
- Currently LAN only; BLE/Wi-Fi Direct transport coming in v1.1

Would love feedback on the protocol design. Full spec: https://github.com/agentviscro/compute-mesh-protocol/blob/main/spec/CMP-v1.0.md

Tech: TypeScript, tweetnacl (X25519/Ed25519), WebAssembly, UDP multicast, TCP.

---

### Posting Tips:
- Post Tuesday-Thursday, 9-11 AM US Eastern (6:30-8:30 PM IST)
- Don't ask for upvotes — just share the link naturally
- Reply to every comment within the first 2 hours
- Be honest about limitations (HN respects this)
- If someone says "just use cloud" → respond with the offline/privacy/cost angle


## ═══════════════════════════════════════════════
## 2. TWITTER/X THREAD
## ═══════════════════════════════════════════════

### Tweet 1 (Hook):
I built a protocol that turns nearby devices into a supercomputer.

No cloud. No internet. No server.

Just phones/laptops discovering each other on Wi-Fi and pooling their idle CPUs.

It's called CMP — Compute Mesh Protocol. Open source. Here's how it works: 🧵

---

### Tweet 2 (Problem):
Your phone uses 10% of its CPU most of the time.

The 6 devices around you? Also idle.

Meanwhile, every AI inference gets routed to a cloud server 2000km away.

What if nearby devices could just... work together?

---

### Tweet 3 (Demo):
Here's two terminals on my Windows machine.

Terminal 1 sends "Hello World" to the mesh.
Terminal 2 encrypts it using a WASM cipher.
Ciphertext flows back. 1.5 seconds. Zero cloud.

[SCREENSHOT OF BOTH TERMINALS]

---

### Tweet 4 (How):
CMP is a 6-layer protocol:

1. Discovery — UDP beacons find nearby devices
2. Capability — devices share their CPU/RAM/GPU specs
3. Negotiation — peers bid on tasks
4. Distribution — work splits into chunks
5. Execution — WASM sandbox (zero system access)
6. Assembly — results verified and merged

---

### Tweet 5 (Security):
Security is zero-trust:

• ECDH key exchange (X25519) per session
• All data encrypted in transit
• WASM sandbox = no filesystem, no network access
• Optional: secret sharing — no single device sees full input
• Redundant execution with majority voting

---

### Tweet 6 (Use Cases):
Real use cases:

🏥 Rural clinic, no internet → 15 phones run AI diagnosis collectively
🌊 Flood destroys cell towers → 200 phones in a camp form a compute mesh
🔒 Analyze financial docs → data never leaves your room
🎓 University lab → 50 idle laptops become a cluster at night

---

### Tweet 7 (Scale):
7.5 billion smartphones on Earth.

Their combined idle compute exceeds all cloud data centers.

CMP is the protocol to unlock that.

---

### Tweet 8 (CTA):
Try it now:

github.com/agentviscro/compute-mesh-protocol

• 10K+ lines TypeScript
• 150 tests passing
• Interactive CLI
• Full protocol spec (RFC-style)
• MIT license

Built solo from Kerala, India.

"The compute is already there. There's just no protocol to use it collectively."

---

### Posting Tips:
- Post same day as HN, but 2 hours later
- Add screenshot/GIF of both terminals showing the encrypt flow
- Pin the thread to your profile
- Quote-tweet the first tweet from @agentviscro account


## ═══════════════════════════════════════════════
## 3. LINKEDIN POST
## ═══════════════════════════════════════════════

I just open-sourced something I've been building: Compute Mesh Protocol (CMP).

The idea is simple: your phone uses 10% of its CPU most of the time. So does every device around you. What if they could work together?

CMP is an open protocol that lets nearby devices discover each other, pool their idle compute, and collectively execute tasks — with zero cloud infrastructure. Think of it as HTTP, but for computation instead of documents.

How it works:
→ Devices find each other via Wi-Fi (UDP multicast)
→ Encrypted sessions via ECDH key exchange
→ Each device advertises its resources (CPU, memory, GPU)
→ Tasks are distributed, executed in WASM sandboxes, and results assembled

I've built the full reference implementation: 10,000+ lines of TypeScript, 150 passing tests, all 6 protocol layers working. The demo runs live — two terminals on the same machine discovering each other, exchanging an encrypted message through the mesh.

Why this matters: AI is moving to the edge. But individual devices can't run large models. A mesh of 5 phones can. No cloud costs. No privacy concerns. No internet required.

Use cases I'm most excited about:
• AI inference in areas without connectivity
• Disaster response computing (zero infrastructure needed)
• Privacy-preserving data processing
• Computational equity for the developing world

The protocol spec and code are MIT licensed. Anyone can implement it.

GitHub: [link]

I'm one developer from Kerala, India. I believe the compute is already there — we just need a protocol to use it collectively.

Would love feedback from the distributed systems community.

#OpenSource #DistributedComputing #Protocol #EdgeAI #WebAssembly


## ═══════════════════════════════════════════════
## 4. REDDIT r/programming
## ═══════════════════════════════════════════════

### Title:
I built an open protocol for proximity-based distributed computation — nearby devices discover each other and pool their idle CPUs (no cloud, no internet)

### Body:
[Same as HN text, slightly shorter, add the GitHub link prominently]


## ═══════════════════════════════════════════════
## 5. TIMING STRATEGY
## ═══════════════════════════════════════════════

Day 0 (Tuesday or Wednesday):
  9:00 AM ET  — Post Show HN
  11:00 AM ET — Twitter thread
  12:00 PM ET — LinkedIn post
  2:00 PM ET  — Reddit r/programming

Day 0 evening:
  — Reply to ALL HN comments within first 6 hours
  — Engage with every Twitter reply

Day 1:
  — Reddit r/compsci (more technical angle)
  — Dev.to article (long-form deep dive)

Day 7:
  — Product Hunt launch
  — Medium cross-post

## ═══════════════════════════════════════════════
## 6. SCREENSHOTS TO CAPTURE
## ═══════════════════════════════════════════════

Before posting, capture these screenshots on your Windows machine:

1. Both terminals showing peer discovery + handshake
2. Terminal 1: "encrypt Hello World" → ciphertext output
3. Terminal 2: "Executing chunk" visible
4. Terminal 1: "decrypt <hex>" → plaintext recovered
5. Terminal 1: "peers" command showing peer table
6. Terminal 1: "status" command showing mesh resources
7. Both terminals side by side (split screen)

Use Windows Snipping Tool (Win+Shift+S) for clean screenshots.

For Twitter, a GIF/video of the full flow is 10x more impactful than screenshots.
Use OBS or Windows Game Bar (Win+G) to record both terminals.
