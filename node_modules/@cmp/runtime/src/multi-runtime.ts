/**
 * CMP Universal Runtime Executor
 * Executes code in ANY programming language on remote peers.
 *
 * How it works:
 *   1. Developer specifies language tag (e.g., "python", "ruby", "go")
 *   2. CMP packs [tag + code] and sends to executor
 *   3. Executor checks if that language's interpreter/compiler is installed
 *   4. If yes: writes code to temp file → runs via subprocess → reads output
 *   5. If no: rejects with "runtime not available"
 *
 * Supported languages (any machine with the interpreter installed):
 *   JavaScript  (JS)  — Node.js VM sandbox (always available, zero setup)
 *   Python      (PY)  — python3 / python
 *   Ruby        (RB)  — ruby
 *   PHP         (PH)  — php
 *   Go          (GO)  — go run
 *   Rust        (RS)  — rustc + execute
 *   C           (CC)  — gcc + execute
 *   C++         (CX)  — g++ + execute
 *   Java        (JA)  — javac + java
 *   Perl        (PL)  — perl
 *   Lua         (LU)  — lua
 *   R           (RR)  — Rscript
 *   Shell       (SH)  — bash / sh
 *   WASM        (WA)  — WebAssembly sandbox (always available)
 *
 * Universal contract:
 *   Every language must define a process(data) function.
 *   Input: data is passed as base64 string (decoded by wrapper)
 *   Output: result written to stdout as base64
 *
 * @module runtime/multi-runtime
 * @author Agent Viscro
 */

import * as vm from 'vm';
import { execFileSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ═══════════════════════════════════════
// Language Registry
// ═══════════════════════════════════════

export interface LanguageConfig {
  /** 2-character wire tag */
  tag: string;
  /** Human-readable name */
  name: string;
  /** File extension for temp file */
  ext: string;
  /** Commands to try (in order) to find the interpreter */
  commands: string[];
  /** Extra args to pass before the file (e.g., suppress warnings) */
  extraArgs?: string[];
  /** How to execute: 'interpret' (run file directly) or 'compile' (compile then run) */
  mode: 'interpret' | 'compile' | 'vm';
  /** Build the wrapper code that calls user's process() function */
  wrapCode: (userCode: string, inputB64: string) => string;
  /** For compiled languages: compile command template */
  compileCmd?: (srcFile: string, outFile: string) => string[];
}

const LANGUAGES: Record<string, LanguageConfig> = {

  javascript: {
    tag: 'JS', name: 'JavaScript', ext: '.js', commands: ['node'], mode: 'vm',
    wrapCode: (code, b64) => code, // Handled by VM directly
  },

  python: {
    tag: 'PY', name: 'Python', ext: '.py', commands: ['python3', 'python', 'py'], mode: 'interpret',
    wrapCode: (code, b64) => `import sys, base64, json
${code}
_input = base64.b64decode("${b64}")
_result = process(_input)
if isinstance(_result, bytes): sys.stdout.write(base64.b64encode(_result).decode())
elif isinstance(_result, str): sys.stdout.write(base64.b64encode(_result.encode()).decode())
elif isinstance(_result, (dict, list, int, float)): sys.stdout.write(base64.b64encode(json.dumps(_result).encode()).decode())
else: sys.stdout.write(base64.b64encode(str(_result).encode()).decode())`,
  },

  ruby: {
    tag: 'RB', name: 'Ruby', ext: '.rb', commands: ['ruby'], mode: 'interpret',
    wrapCode: (code, b64) => `
require 'base64'
require 'json'
${code}
_input = Base64.decode64("${b64}")
_result = process(_input)
case _result
when String then print Base64.strict_encode64(_result)
when Hash, Array then print Base64.strict_encode64(_result.to_json)
when Numeric then print Base64.strict_encode64(_result.to_s)
else print Base64.strict_encode64(_result.to_s)
end
`,
  },

  php: {
    tag: 'PH', name: 'PHP', ext: '.php', commands: ['php'],
    extraArgs: ['-d', 'display_startup_errors=0', '-d', 'display_errors=0'],
    mode: 'interpret',
    wrapCode: (code, b64) => {
      // Strip <?php and ?> tags if user included them
      let cleaned = code.replace(/^\s*<\?php\s*/i, '').replace(/\?>\s*$/, '');
      return '<?php error_reporting(0);\n'
        + cleaned + '\n'
        + '$_input = base64_decode("' + b64 + '");\n'
        + '$_result = process($_input);\n'
        + 'if (is_string($_result)) echo base64_encode($_result);\n'
        + 'elseif (is_array($_result) || is_object($_result)) echo base64_encode(json_encode($_result));\n'
        + 'else echo base64_encode(strval($_result));';
    },
  },

  go: {
    tag: 'GO', name: 'Go', ext: '.go', commands: ['go'], mode: 'interpret',
    wrapCode: (code, b64) => `package main
import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
)
${code}
func main() {
	inputBytes, _ := base64.StdEncoding.DecodeString("${b64}")
	result := process(inputBytes)
	switch v := result.(type) {
	case []byte:
		fmt.Print(base64.StdEncoding.EncodeToString(v))
	case string:
		fmt.Print(base64.StdEncoding.EncodeToString([]byte(v)))
	default:
		j, _ := json.Marshal(v)
		fmt.Print(base64.StdEncoding.EncodeToString(j))
	}
	os.Exit(0)
}
`,
  },

  rust: {
    tag: 'RS', name: 'Rust', ext: '.rs', commands: ['rustc'], mode: 'compile',
    compileCmd: (src, out) => ['rustc', '-o', out, src],
    wrapCode: (code, b64) => `
use std::io::Write;
${code}
fn main() {
    let input = base64_decode("${b64}");
    let result = process(&input);
    let encoded = base64_encode(&result);
    std::io::stdout().write_all(encoded.as_bytes()).unwrap();
}
fn base64_decode(s: &str) -> Vec<u8> {
    let mut out = Vec::new();
    let chars: Vec<u8> = s.bytes().collect();
    let table = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut i = 0;
    while i < chars.len() {
        let a = table.iter().position(|&c| c == chars[i]).unwrap_or(0) as u32;
        let b = if i+1 < chars.len() { table.iter().position(|&c| c == chars[i+1]).unwrap_or(0) as u32 } else { 0 };
        let c = if i+2 < chars.len() && chars[i+2] != b'=' { table.iter().position(|&c| c == chars[i+2]).unwrap_or(0) as u32 } else { 0 };
        let d = if i+3 < chars.len() && chars[i+3] != b'=' { table.iter().position(|&c| c == chars[i+3]).unwrap_or(0) as u32 } else { 0 };
        let triple = (a << 18) | (b << 12) | (c << 6) | d;
        out.push(((triple >> 16) & 0xFF) as u8);
        if i+2 < chars.len() && chars[i+2] != b'=' { out.push(((triple >> 8) & 0xFF) as u8); }
        if i+3 < chars.len() && chars[i+3] != b'=' { out.push((triple & 0xFF) as u8); }
        i += 4;
    }
    out
}
fn base64_encode(data: &[u8]) -> String {
    let table = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    let mut i = 0;
    while i < data.len() {
        let a = data[i] as u32;
        let b = if i+1 < data.len() { data[i+1] as u32 } else { 0 };
        let c = if i+2 < data.len() { data[i+2] as u32 } else { 0 };
        let triple = (a << 16) | (b << 8) | c;
        out.push(table[((triple >> 18) & 0x3F) as usize] as char);
        out.push(table[((triple >> 12) & 0x3F) as usize] as char);
        if i+1 < data.len() { out.push(table[((triple >> 6) & 0x3F) as usize] as char); } else { out.push('='); }
        if i+2 < data.len() { out.push(table[(triple & 0x3F) as usize] as char); } else { out.push('='); }
        i += 3;
    }
    out
}
`,
  },

  c: {
    tag: 'CC', name: 'C', ext: '.c', commands: ['gcc', 'cc'], mode: 'compile',
    compileCmd: (src, out) => ['gcc', '-o', out, src, '-lm'],
    wrapCode: (code, b64) => `
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
${code}
/* Base64 decode */
static const char b64chars[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
int b64_decode(const char *in, unsigned char *out, int *outlen) {
    int i, j = 0, pad = 0;
    int len = strlen(in);
    for (i = 0; i < len; i += 4) {
        int a = strchr(b64chars, in[i]) - b64chars;
        int b = strchr(b64chars, in[i+1]) - b64chars;
        int c = in[i+2] == '=' ? 0 : strchr(b64chars, in[i+2]) - b64chars;
        int d = in[i+3] == '=' ? 0 : strchr(b64chars, in[i+3]) - b64chars;
        int triple = (a << 18) | (b << 12) | (c << 6) | d;
        out[j++] = (triple >> 16) & 0xFF;
        if (in[i+2] != '=') out[j++] = (triple >> 8) & 0xFF;
        if (in[i+3] != '=') out[j++] = triple & 0xFF;
    }
    *outlen = j;
    return 0;
}
void b64_encode(const unsigned char *in, int len, char *out) {
    int i, j = 0;
    for (i = 0; i < len; i += 3) {
        int a = in[i];
        int b = i+1 < len ? in[i+1] : 0;
        int c = i+2 < len ? in[i+2] : 0;
        int triple = (a << 16) | (b << 8) | c;
        out[j++] = b64chars[(triple >> 18) & 0x3F];
        out[j++] = b64chars[(triple >> 12) & 0x3F];
        out[j++] = i+1 < len ? b64chars[(triple >> 6) & 0x3F] : '=';
        out[j++] = i+2 < len ? b64chars[triple & 0x3F] : '=';
    }
    out[j] = 0;
}
int main() {
    unsigned char input[1048576];
    int input_len;
    b64_decode("${b64}", input, &input_len);
    int result_len;
    unsigned char *result = process(input, input_len, &result_len);
    char *encoded = malloc(result_len * 2 + 4);
    b64_encode(result, result_len, encoded);
    printf("%s", encoded);
    free(encoded);
    return 0;
}
`,
  },

  java: {
    tag: 'JA', name: 'Java', ext: '.java', commands: ['java'], mode: 'interpret',
    wrapCode: (code, b64) => `
import java.util.Base64;
public class CmpTask {
    ${code}
    public static void main(String[] args) {
        byte[] input = Base64.getDecoder().decode("${b64}");
        Object result = process(input);
        byte[] output;
        if (result instanceof byte[]) output = (byte[])result;
        else if (result instanceof String) output = ((String)result).getBytes();
        else output = result.toString().getBytes();
        System.out.print(Base64.getEncoder().encodeToString(output));
    }
}
`,
  },

  perl: {
    tag: 'PL', name: 'Perl', ext: '.pl', commands: ['perl'], mode: 'interpret',
    wrapCode: (code, b64) => `
use MIME::Base64;
${code}
my $input = decode_base64("${b64}");
my $result = process($input);
print encode_base64($result, "");
`,
  },

  lua: {
    tag: 'LU', name: 'Lua', ext: '.lua', commands: ['lua', 'lua5.4', 'lua5.3'], mode: 'interpret',
    wrapCode: (code, b64) => `
local b64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
local function b64dec(data)
    data = string.gsub(data, '[^'..b64..'=]', '')
    return (data:gsub('.', function(x)
        if x == '=' then return '' end
        local r, f = '', (b64:find(x)-1)
        for i = 6, 1, -1 do r = r .. (f % 2^i - f % 2^(i-1) > 0 and '1' or '0') end
        return r
    end):gsub('%d%d%d?%d?%d?%d?%d?%d?', function(x)
        if #x ~= 8 then return '' end
        local c = 0
        for i = 1, 8 do c = c + (x:sub(i,i) == '1' and 2^(8-i) or 0) end
        return string.char(c)
    end))
end
local function b64enc(data)
    return ((data:gsub('.', function(x)
        local r, b = '', x:byte()
        for i = 8, 1, -1 do r = r .. (b % 2^i - b % 2^(i-1) > 0 and '1' or '0') end
        return r
    end)..'0000'):gsub('%d%d%d?%d?%d?%d?', function(x)
        if #x < 6 then return '' end
        local c = 0
        for i = 1, 6 do c = c + (x:sub(i,i) == '1' and 2^(6-i) or 0) end
        return b64:sub(c+1, c+1)
    end)..({'', '==', '='})[#data % 3 + 1])
end
${code}
local input = b64dec("${b64}")
local result = process(input)
io.write(b64enc(result))
`,
  },

  r: {
    tag: 'RR', name: 'R', ext: '.R', commands: ['Rscript'], mode: 'interpret',
    wrapCode: (code, b64) => `
${code}
input <- base64enc::base64decode("${b64}")
result <- process(input)
if (is.raw(result)) cat(base64enc::base64encode(result))
else cat(base64enc::base64encode(charToRaw(as.character(result))))
`,
  },

  shell: {
    tag: 'SH', name: 'Shell', ext: '.sh', commands: ['bash', 'sh'], mode: 'interpret',
    wrapCode: (code, b64) => `#!/bin/bash
${code}
INPUT=$(echo "${b64}" | base64 -d)
RESULT=$(process "$INPUT")
echo -n "$RESULT" | base64
`,
  },
};

/** All supported runtime types */
export type RuntimeType = keyof typeof LANGUAGES | 'wasm';

/** Runtime tags in wire format */
const TAG_TO_LANG: Record<string, string> = {};
for (const [lang, config] of Object.entries(LANGUAGES)) {
  TAG_TO_LANG[config.tag] = lang;
}

// ═══════════════════════════════════════
// Wire Format
// ═══════════════════════════════════════

/**
 * Pack code with runtime tag.
 * Format: [tag: 2B][code bytes]
 */
export function packCodePayload(runtime: RuntimeType, code: Uint8Array): Uint8Array {
  const lang = LANGUAGES[runtime as string];
  if (!lang) throw new Error(`Unknown runtime: ${runtime}`);
  const tagBytes = new TextEncoder().encode(lang.tag);
  const result = new Uint8Array(2 + code.length);
  result.set(tagBytes, 0);
  result.set(code, 2);
  return result;
}

/**
 * Detect if a "wasmModule" is actually multi-runtime code.
 * Returns the runtime type and code, or null if it's regular WASM.
 */
export function detectRuntime(moduleBytes: Uint8Array): {
  runtime: string;
  code: Uint8Array;
} | null {
  if (moduleBytes.length < 4) return null;

  // Check for WASM magic: \0asm
  if (moduleBytes[0] === 0x00 && moduleBytes[1] === 0x61 &&
      moduleBytes[2] === 0x73 && moduleBytes[3] === 0x6D) {
    return null; // Regular WASM
  }

  // Check for runtime tag
  const tag = new TextDecoder().decode(moduleBytes.slice(0, 2));
  const lang = TAG_TO_LANG[tag];
  if (!lang) return null;

  const code = moduleBytes.slice(2);
  return { runtime: lang, code };
}

// ═══════════════════════════════════════
// Execution
// ═══════════════════════════════════════

/**
 * Execute JavaScript code in a sandboxed VM.
 */
export function executeJavaScript(code: string, input: Uint8Array, timeoutMs: number = 10000): Uint8Array {
  const sandbox = {
    __input: Buffer.from(input),
    __result: null as any,
    console: { log: () => {}, error: () => {}, warn: () => {} },
    JSON, Math, parseInt, parseFloat, isNaN, isFinite,
    Buffer, TextEncoder, TextDecoder,
    Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array,
    Float32Array, Float64Array, ArrayBuffer, DataView,
    Array, Object, String, Number, Boolean, Date, RegExp, Map, Set, Error,
  };

  const wrappedCode = `
    ${code}
    if (typeof process === 'function') __result = process(__input);
    else if (typeof main === 'function') __result = main(__input);
    else throw new Error('Code must define process(data) or main(data) function');
  `;

  const context = vm.createContext(sandbox);
  vm.runInContext(wrappedCode, context, { timeout: timeoutMs, filename: 'cmp-exec.js' });

  return resultToBytes(sandbox.__result);
}

/**
 * Execute code via subprocess (works for any language with an interpreter).
 */
export function executeSubprocess(
  lang: LanguageConfig,
  code: string,
  input: Uint8Array,
  timeoutMs: number = 30000
): Uint8Array {
  const inputB64 = Buffer.from(input).toString('base64');
  const wrappedCode = lang.wrapCode(code, inputB64);

  const id = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const tmpDir = path.join(os.tmpdir(), 'cmp-exec');
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}

  // For Java, filename must match class name
  const filename = lang.tag === 'JA' ? 'CmpTask' : `cmp-${id}`;
  const srcFile = path.join(tmpDir, `${filename}${lang.ext}`);

  try {
    fs.writeFileSync(srcFile, wrappedCode);

    const cmd = findCommand(lang.commands);
    if (!cmd) {
      throw new Error(`${lang.name} not found. Install ${lang.commands[0]} and ensure it is on PATH`);
    }

    let stdout: string;

    if (lang.mode === 'compile' && lang.compileCmd) {
      // Compile then run
      const outExt = process.platform === 'win32' ? '.exe' : '';
      const outFile = path.join(tmpDir, `cmp-${id}${outExt}`);
      const compileArgs = lang.compileCmd(srcFile, outFile);

      try {
        execFileSync(compileArgs[0], compileArgs.slice(1), {
          timeout: timeoutMs, encoding: 'utf8', stdio: 'pipe',
        });
        stdout = execFileSync(outFile, [], {
          timeout: timeoutMs, encoding: 'utf8', stdio: 'pipe',
        });
      } catch (execErr: any) {
        throw new Error(`${lang.name} compile/run failed: ${execErr.stderr || execErr.message}`);
      } finally {
        try { fs.unlinkSync(outFile); } catch {}
      }
    } else if (lang.tag === 'GO') {
      try {
        stdout = execFileSync(cmd, ['run', srcFile], {
          timeout: timeoutMs, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024,
        });
      } catch (execErr: any) {
        throw new Error(`${lang.name} execution failed: ${execErr.stderr || execErr.message}`);
      }
    } else if (lang.tag === 'JA') {
      try {
        stdout = execFileSync(cmd, [srcFile], {
          timeout: timeoutMs, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], cwd: tmpDir, maxBuffer: 50 * 1024 * 1024,
        });
      } catch (execErr: any) {
        throw new Error(`${lang.name} execution failed: ${execErr.stderr || execErr.message}`);
      }
    } else {
      // Interpreted: run directly
      const runArgs = [...(lang.extraArgs || []), srcFile];
      try {
        stdout = execFileSync(cmd, runArgs, {
          timeout: timeoutMs,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          maxBuffer: 50 * 1024 * 1024,
        });
      } catch (execErr: any) {
        // Some languages (PHP) emit warnings to stderr but still produce valid output
        if (execErr.stdout && execErr.stdout.trim()) {
          stdout = execErr.stdout;
        } else {
          const stderr = execErr.stderr || '';
          throw new Error(`${lang.name} execution failed: ${stderr || execErr.message}`);
        }
      }
    }

    // Validate output is proper base64
    const trimmed = stdout.trim();
    if (!trimmed) {
      throw new Error(`${lang.name} subprocess produced no output. Code may have errors.`);
    }

    // Strip any non-base64 prefix/suffix (PHP/Perl may output warnings)
    const b64Match = trimmed.match(/[A-Za-z0-9+/]+=*$/);
    const cleanB64 = b64Match ? b64Match[0] : trimmed;

    try {
      return new Uint8Array(Buffer.from(cleanB64, 'base64'));
    } catch {
      throw new Error(`${lang.name} output is not valid base64. Raw output: ${trimmed.substring(0, 200)}`);
    }
  } finally {
    try { fs.unlinkSync(srcFile); } catch {}
  }
}

/**
 * Execute Python code (convenience alias).
 */
export function executePython(code: string, input: Uint8Array, timeoutMs: number = 30000): Uint8Array {
  return executeSubprocess(LANGUAGES.python, code, input, timeoutMs);
}

/**
 * Execute code in any supported runtime.
 */
export function executeMultiRuntime(
  runtime: string,
  code: Uint8Array,
  input: Uint8Array,
  timeoutMs: number = 10000
): Uint8Array {
  const codeStr = new TextDecoder().decode(code);
  const lang = LANGUAGES[runtime];

  if (!lang) {
    throw new Error(`Unsupported runtime: ${runtime}. Available: ${Object.keys(LANGUAGES).join(', ')}`);
  }

  if (lang.mode === 'vm') {
    return executeJavaScript(codeStr, input, timeoutMs);
  } else {
    return executeSubprocess(lang, codeStr, input, timeoutMs);
  }
}

// ═══════════════════════════════════════
// Runtime Detection
// ═══════════════════════════════════════

/**
 * Check if a runtime is available on this machine.
 */
export function isRuntimeAvailable(runtime: RuntimeType): boolean {
  if (runtime === 'javascript' || runtime === 'wasm') return true;
  const lang = LANGUAGES[runtime as string];
  if (!lang) return false;
  return findCommand(lang.commands) !== null;
}

/**
 * List all available runtimes on this machine.
 */
export function listAvailableRuntimes(): { runtime: string; name: string; command: string }[] {
  const available: { runtime: string; name: string; command: string }[] = [
    { runtime: 'javascript', name: 'JavaScript', command: 'node (built-in VM)' },
    { runtime: 'wasm', name: 'WebAssembly', command: 'built-in sandbox' },
  ];

  for (const [key, lang] of Object.entries(LANGUAGES)) {
    if (lang.mode === 'vm') continue; // Already added JS
    const cmd = findCommand(lang.commands);
    if (cmd) {
      available.push({ runtime: key, name: lang.name, command: cmd });
    }
  }

  return available;
}

/**
 * Get all supported language names (whether installed or not).
 */
export function listAllLanguages(): { runtime: string; name: string; tag: string; installed: boolean }[] {
  return Object.entries(LANGUAGES).map(([key, lang]) => ({
    runtime: key,
    name: lang.name,
    tag: lang.tag,
    installed: lang.mode === 'vm' ? true : findCommand(lang.commands) !== null,
  }));
}

// ═══════════════════════════════════════
// Helpers
// ═══════════════════════════════════════

function resultToBytes(result: any): Uint8Array {
  if (result === null || result === undefined) return new Uint8Array(0);
  if (result instanceof Uint8Array) return result;
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (Buffer.isBuffer(result)) return new Uint8Array(result);
  if (typeof result === 'string') return new TextEncoder().encode(result);
  if (typeof result === 'number') {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setFloat64(0, result, false);
    return buf;
  }
  if (typeof result === 'object') return new TextEncoder().encode(JSON.stringify(result));
  return new TextEncoder().encode(String(result));
}

const _commandCache = new Map<string, string | null>();

function findCommand(candidates: string[]): string | null {
  const key = candidates.join('|');
  if (_commandCache.has(key)) return _commandCache.get(key)!;

  for (const cmd of candidates) {
    try {
      if (process.platform === 'win32') {
        execSync(`where ${cmd}`, { encoding: 'utf8', stdio: 'pipe', timeout: 5000 });
      } else {
        execSync(`which ${cmd}`, { encoding: 'utf8', stdio: 'pipe', timeout: 5000 });
      }
      _commandCache.set(key, cmd);
      return cmd;
    } catch {}
  }

  _commandCache.set(key, null);
  return null;
}
