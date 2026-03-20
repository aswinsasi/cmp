/**
 * Generate a valid WASM module that XOR-encrypts each byte with a key.
 * Tests it locally to ensure it compiles and runs correctly.
 */

async function main() {
  // Build WASM binary for XOR cipher by assembling valid sections
  // The module: memory(1 page) + func process(ptr, len) -> len that XORs each byte with 0x2A (42)

  const bytes = buildXORModule(0x2A);
  
  // Validate: compile and test
  const module = await WebAssembly.compile(bytes);
  const memory = new WebAssembly.Memory({ initial: 1 });
  const instance = await WebAssembly.instantiate(module, { env: { memory } });
  
  const exports = instance.exports;
  console.log('Exports:', Object.keys(exports));
  
  // Test: write "Hello CMP!" to memory and process it
  const input = new TextEncoder().encode('Hello CMP!');
  const mem = new Uint8Array(memory.buffer);
  mem.set(input, 0);
  
  const resultLen = exports.process(0, input.length);
  console.log('Result length:', resultLen);
  
  // Read output
  const output = new Uint8Array(memory.buffer, 0, resultLen);
  console.log('Input: ', Buffer.from(input).toString('hex'));
  console.log('Output:', Buffer.from(output).toString('hex'));
  
  // Verify: XOR again should give back original
  for (let i = 0; i < resultLen; i++) {
    mem[i] = output[i] ^ 0x2A;
  }
  const decrypted = new TextDecoder().decode(new Uint8Array(memory.buffer, 0, resultLen));
  console.log('Decrypted:', decrypted);
  console.log('Match:', decrypted === 'Hello CMP!');
  
  // Output the bytes as a TypeScript array
  console.log('\n// WASM module bytes:');
  console.log(`const XOR_WASM = new Uint8Array([${Array.from(bytes).join(', ')}]);`);
  console.log(`// Size: ${bytes.length} bytes`);
}

function buildXORModule(xorKey) {
  // Manual WASM binary assembly
  // Reference: https://webassembly.github.io/spec/core/binary/
  
  const buf = [];
  
  // ── Magic + Version ──
  buf.push(0x00, 0x61, 0x73, 0x6D); // \0asm
  buf.push(0x01, 0x00, 0x00, 0x00); // version 1
  
  // ── Type Section (id=1) ──
  // One function type: (i32, i32) -> i32
  const typeSection = [
    0x01,                   // 1 type
    0x60,                   // func type
    0x02, 0x7F, 0x7F,      // 2 params: i32, i32
    0x01, 0x7F,             // 1 result: i32
  ];
  buf.push(0x01); // section id
  buf.push(typeSection.length); // section size
  buf.push(...typeSection);
  
  // ── Import Section (id=2) ──
  // Import memory from env
  const importSection = [
    0x01,                   // 1 import
    // "env" . "memory"
    0x03, 0x65, 0x6E, 0x76, // "env"
    0x06, 0x6D, 0x65, 0x6D, 0x6F, 0x72, 0x79, // "memory"
    0x02,                   // memory import
    0x00, 0x01,             // limits: min=1, no max
  ];
  buf.push(0x02);
  buf.push(importSection.length);
  buf.push(...importSection);
  
  // ── Function Section (id=3) ──
  // One function, type index 0
  const funcSection = [0x01, 0x00];
  buf.push(0x03);
  buf.push(funcSection.length);
  buf.push(...funcSection);
  
  // ── Export Section (id=7) ──
  // Export "process" as func 0
  const exportSection = [
    0x01,                   // 1 export
    0x07,                   // name length
    0x70, 0x72, 0x6F, 0x63, 0x65, 0x73, 0x73, // "process"
    0x00,                   // func export
    0x00,                   // func index 0
  ];
  buf.push(0x07);
  buf.push(exportSection.length);
  buf.push(...exportSection);
  
  // ── Code Section (id=10) ──
  // Function body: XOR each byte at ptr..ptr+len with xorKey, return len
  //
  // local $i : i32
  // loop:
  //   if ($i >= $len) break
  //   mem[$ptr + $i] = mem[$ptr + $i] XOR xorKey
  //   $i = $i + 1
  //   br loop
  // return $len
  
  const funcBody = [
    0x01,                   // 1 local declaration
    0x01, 0x7F,             // 1 local of type i32 ($i at index 2)
    
    // $i = 0
    0x41, 0x00,             // i32.const 0
    0x21, 0x02,             // local.set 2 ($i)
    
    // block $break
    0x02, 0x40,             // block void
    
    // loop $loop
    0x03, 0x40,             // loop void
    
    // br_if $break ($i >= $len)
    0x20, 0x02,             // local.get $i
    0x20, 0x01,             // local.get $len
    0x4F,                   // i32.ge_u
    0x0D, 0x01,             // br_if 1 (break)
    
    // mem[$ptr + $i] = mem[$ptr + $i] XOR key
    // store address
    0x20, 0x00,             // local.get $ptr
    0x20, 0x02,             // local.get $i
    0x6A,                   // i32.add ($ptr + $i)
    
    // load value
    0x20, 0x00,             // local.get $ptr
    0x20, 0x02,             // local.get $i
    0x6A,                   // i32.add
    0x2D, 0x00, 0x00,       // i32.load8_u offset=0 align=0
    
    // XOR with key
    0x41, xorKey & 0x7F,    // i32.const key (LEB128, works for key < 128)
    0x73,                   // i32.xor
    
    // store
    0x3A, 0x00, 0x00,       // i32.store8 offset=0 align=0
    
    // $i = $i + 1
    0x20, 0x02,             // local.get $i
    0x41, 0x01,             // i32.const 1
    0x6A,                   // i32.add
    0x21, 0x02,             // local.set $i
    
    // br $loop
    0x0C, 0x00,             // br 0 (loop)
    
    0x0B,                   // end loop
    0x0B,                   // end block
    
    // return $len
    0x20, 0x01,             // local.get $len
    0x0B,                   // end func
  ];
  
  const codeSection = [
    0x01,                   // 1 function body
    funcBody.length,        // body size
    ...funcBody,
  ];
  buf.push(0x0A);
  buf.push(codeSection.length);
  buf.push(...codeSection);
  
  return new Uint8Array(buf);
}

main().catch(console.error);
