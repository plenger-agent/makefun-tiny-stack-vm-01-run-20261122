// A tiny stack virtual machine, written from ISA.md: for every instance under the input
// directory it runs program.bin on input.bin and writes what the program wrote and the
// code it ended with, a trap's code included.
import { mkdirSync as D, readdirSync as R, readFileSync as F, writeFileSync as W } from 'node:fs';
import { join as J } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Every opcode's stack needs packed as one hex digit per opcode byte, pops * 4 + pushes
// ('.' is not an opcode), in the ISA's order: shuffles, arithmetic, jumps, memory, I/O.
const T = '01146abf........999999959995999.999.............04400...........58..............4414';

function run(p, q) {
  const n = p.length;
  const S = new Int32Array(256), C = new Int32Array(64), M = new Int32Array(256);
  let s = 0, c = 0, pc = 0, w = 0, ip = 0;
  const out = [];
  const end = (e) => ({ o: Uint8Array.from(out), c: e });
  for (;;) {
    // One step, in the ISA's order: step limit, pc, opcode, immediate, stack, then the effect.
    if (w >= 1e6) return end(10);
    if (pc < 0 || pc >= n) return end(9);
    const op = p[pc];
    const v = T.charCodeAt(op); // '.' and past-the-end both decode below zero: not an opcode
    const need = v > 90 ? v - 87 : v - 48;
    if (!(need >= 0)) return end(5);
    const imm = op === 1 ? 1 : op === 2 ? 4 : op >= 48 && op <= 51 ? 2 : 0;
    if (pc + imm >= n) return end(9);
    w++;
    if (s < need >> 2) return end(2);
    if (s - (need >> 2) + (need & 3) > 256) return end(3);
    const nx = pc + 1 + imm;
    pc = nx;
    switch (op) {
      case 0: return end(0);
      case 1: S[s++] = (p[nx - 1] << 24) >> 24; break; // PUSH8, sign-extended
      case 2: S[s++] = p[nx - 4] | p[nx - 3] << 8 | p[nx - 2] << 16 | p[nx - 1] << 24; break;
      case 3: s--; break;
      case 4: S[s] = S[s - 1]; s++; break;
      case 5: { const t = S[s - 1]; S[s - 1] = S[s - 2]; S[s - 2] = t; break; }
      case 6: S[s] = S[s - 2]; s++; break;
      case 7: { const t = S[s - 3]; S[s - 3] = S[s - 2]; S[s - 2] = S[s - 1]; S[s - 1] = t; break; }
      case 23: S[s - 1] = -S[s - 1]; break; // NEG (the store wraps INT_MIN back)
      case 27: S[s - 1] = ~S[s - 1]; break;
      case 48: case 49: case 50: { // JMP, JZ, JNZ: a signed offset from the next instruction
        const rel = ((p[nx - 2] | p[nx - 1] << 8) << 16) >> 16;
        if (op === 48 || (S[--s] === 0) === (op === 49)) pc = nx + rel;
        break;
      }
      case 51: // CALL: the immediate is the unsigned address itself
        if (c === 64) return end(7);
        C[c++] = nx; pc = p[nx - 2] | p[nx - 1] << 8; break;
      case 52:
        if (c === 0) return end(8);
        pc = C[--c]; break;
      case 64: case 65: { // LOAD and STORE share the address check; STORE is ( v addr -- )
        const a = S[s - 1];
        if (a < 0 || a > 255) return end(6);
        if (op === 64) S[s - 1] = M[a];
        else { M[a] = S[s - 2]; s -= 2; }
        break;
      }
      case 80: { // PRINT: the value in decimal, all of it or none of it
        const t = String(S[s - 1]);
        if (out.length + t.length > 65536) return end(11);
        s--;
        for (let i = 0; i < t.length;) out.push(t.charCodeAt(i++));
        break;
      }
      case 81: // PUTC: one byte, the value's low byte
        if (out.length > 65535) return end(11);
        out.push(S[--s] & 255); break;
      case 82: S[s++] = ip < q.length ? q[ip++] : -1; break; // IN: -1 once the input is used up
      case 83: return end(S[--s] & 255); // EXIT: the value's low byte
      default: { // the binary ops: two values in, one out, the store wraps to 32 bits
        const b = S[--s], a = S[--s];
        let r;
        if (op < 19) r = op === 16 ? a + b : op === 17 ? a - b : Math.imul(a, b);
        else if (op < 23) {
          if (!b) return end(4);
          r = op === 19 ? (a / b) | 0 : op === 20 ? a % b : op === 21 ? Math.floor((a >>> 0) / (b >>> 0)) : (a >>> 0) % (b >>> 0);
        } else if (op < 27) r = op === 24 ? a & b : op === 25 ? a | b : a ^ b;
        else if (op < 31) r = op === 28 ? a << (b & 31) : op === 29 ? a >> (b & 31) : a >>> (b & 31);
        else r = op === 32 ? (a === b ? 1 : 0) : op === 33 ? (a < b ? 1 : 0) : (a >>> 0) < (b >>> 0) ? 1 : 0;
        S[s++] = r;
      }
    }
  }
}

for (const id of R(I).sort()) {
  const r = run(F(J(I, id, 'program.bin')), F(J(I, id, 'input.bin')));
  D(J(O, id), { recursive: true });
  W(J(O, id, 'stdout.bin'), r.o);
  W(J(O, id, 'exit.txt'), r.c + '\n');
}
