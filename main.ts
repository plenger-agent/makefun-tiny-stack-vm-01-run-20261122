// Tiny stack VM: runs every instance, writes stdout.bin + exit.txt per instance.
// ISA: kit program/generator/subject/ISA.md; reference VM: .../subject/vm.mjs.
import { mkdirSync as D, readdirSync as R, readFileSync as F, writeFileSync as W } from "node:fs";
import { join as J } from "node:path";

const I = process.env.MAKEFUN_INPUT_DIR ?? "/input";
const O = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

// [immediate bytes, pops, pushes] per opcode byte; absent = unknown opcode.
const M = {0:[0,0,0],1:[1,0,1],2:[4,0,1],3:[0,1,0],4:[0,1,2],5:[0,2,2],6:[0,2,3],7:[0,3,3],16:[0,2,1],17:[0,2,1],18:[0,2,1],19:[0,2,1],20:[0,2,1],21:[0,2,1],22:[0,2,1],23:[0,1,1],24:[0,2,1],25:[0,2,1],26:[0,2,1],27:[0,1,1],28:[0,2,1],29:[0,2,1],30:[0,2,1],32:[0,2,1],33:[0,2,1],34:[0,2,1],48:[2,0,0],49:[2,1,0],50:[2,1,0],51:[2,0,0],52:[0,0,0],64:[0,1,1],65:[0,2,0],80:[0,1,0],81:[0,1,0],82:[0,0,1],83:[0,1,0]};

// Run one program on its input; return [output bytes, exit code].
// A trap ends the run at once with the trap's code, keeping prior output.
function run(p, q) {
  const n = p.length, S = new Int32Array(256), C = new Int32Array(64), E = new Int32Array(256), o = new Uint8Array(65536);
  let s = 0, c = 0, l = 0, i = 0, j = 0, w = 0;
  const end = (e) => [o.subarray(0, l), e];
  for (;;) {
    // Step order: step limit, pc range, opcode, immediate fit, stack needs, then effect.
    if (w === 1e6) return end(10);
    if (j < 0 || j >= n) return end(9);
    const op = p[j], m = M[op];
    if (!m) return end(5);
    const im = m[0], po = m[1], pu = m[2];
    if (j + im >= n) return end(9);
    w++;
    const nx = j + 1 + im;
    if (s < po) return end(2);
    if (s - po + pu > 256) return end(3);
    j = nx;
    if (op === 0) return end(0); // HALT
    if (op === 1) { S[s++] = (p[nx - 1] << 24) >> 24; continue; } // PUSH8, sign-extended
    if (op === 2) { S[s++] = p[nx - 4] | p[nx - 3] << 8 | p[nx - 2] << 16 | p[nx - 1] << 24; continue; } // PUSH32
    if (op === 3) { s--; continue; } // POP
    if (op === 4) { S[s] = S[s - 1]; s++; continue; } // DUP
    if (op === 5) { const t = S[s - 1]; S[s - 1] = S[s - 2]; S[s - 2] = t; continue; } // SWAP
    if (op === 6) { S[s] = S[s - 2]; s++; continue; } // OVER
    if (op === 7) { const a = S[s - 3]; S[s - 3] = S[s - 2]; S[s - 2] = S[s - 1]; S[s - 1] = a; continue; } // ROT
    if (op === 23) { S[s - 1] = -S[s - 1] | 0; continue; } // NEG, wraps
    if (op === 27) { S[s - 1] = ~S[s - 1]; continue; } // NOT
    if (op >= 16 && op <= 34) { // two-operand arithmetic / logic / compare
      const b = S[s - 1], a = S[s - 2];
      let r;
      if (op === 16) r = (a + b) | 0;
      else if (op === 17) r = (a - b) | 0;
      else if (op === 18) r = Math.imul(a, b); // low 32 bits of the exact product
      else if (op === 19) { if (!b) return end(4); r = a === -2147483648 && b === -1 ? a : (a / b) | 0; } // DIV
      else if (op === 20) { if (!b) return end(4); r = b === -1 ? 0 : (a % b) | 0; } // MOD, sign of a
      else if (op === 21) { if (!b) return end(4); r = Math.floor((a >>> 0) / (b >>> 0)) | 0; } // DIVU
      else if (op === 22) { if (!b) return end(4); r = ((a >>> 0) % (b >>> 0)) | 0; } // MODU
      else if (op === 24) r = a & b;
      else if (op === 25) r = a | b;
      else if (op === 26) r = a ^ b;
      else if (op === 28) r = a << (b & 31); // shift counts use only the low 5 bits
      else if (op === 29) r = a >> (b & 31);
      else if (op === 30) r = a >>> (b & 31);
      else if (op === 32) r = a === b ? 1 : 0;
      else if (op === 33) r = a < b ? 1 : 0;
      else r = (a >>> 0) < (b >>> 0) ? 1 : 0; // LTU
      s -= 2;
      S[s++] = r;
      continue;
    }
    if (op >= 48 && op <= 50) { // JMP / JZ / JNZ
      const rel = ((p[nx - 2] | p[nx - 1] << 8) << 16) >> 16; // signed 16-bit offset
      let take = true;
      if (op !== 48) { const v = S[--s]; take = op === 49 ? v === 0 : v !== 0; }
      if (take) j = nx + rel;
      continue;
    }
    if (op === 51) { // CALL
      if (c === 64) return end(7);
      C[c++] = nx;
      j = p[nx - 2] | p[nx - 1] << 8;
      continue;
    }
    if (op === 52) { // RET
      if (c === 0) return end(8);
      j = C[--c];
      continue;
    }
    if (op === 64) { // LOAD
      const a = S[s - 1];
      if (a < 0 || a > 255) return end(6);
      S[s - 1] = E[a];
      continue;
    }
    if (op === 65) { // STORE ( v addr -- )
      const a = S[s - 1], v = S[s - 2];
      if (a < 0 || a > 255) return end(6);
      s -= 2;
      E[a] = v;
      continue;
    }
    if (op === 80) { // PRINT: decimal ASCII, all of it or none of it
      const t = String(S[s - 1]);
      if (l + t.length > 65536) return end(11);
      s--;
      for (let k = 0; k < t.length; k++) o[l++] = t.charCodeAt(k);
      continue;
    }
    if (op === 81) { // PUTC: one byte, the value's low byte
      if (l + 1 > 65536) return end(11);
      o[l++] = S[--s] & 255;
      continue;
    }
    if (op === 82) { S[s++] = i < q.length ? q[i++] : -1; continue; } // IN, -1 past the end
    return end(S[--s] & 255); // EXIT: the value's low byte
  }
}

for (const id of R(I).sort()) {
  const d = J(I, id);
  let p;
  try { p = F(J(d, "program.bin")); } catch { continue; }
  let q;
  try { q = F(J(d, "input.bin")); } catch { q = Buffer.alloc(0); }
  const [o, e] = run(p, q);
  D(J(O, id), { recursive: true });
  W(J(O, id, "stdout.bin"), o);
  W(J(O, id, "exit.txt"), e + "\n");
}
