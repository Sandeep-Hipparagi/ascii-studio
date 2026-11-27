/**
 * Dedicated Web Worker for Gray-Scott Reaction-Diffusion simulation.
 * Advances double-buffered U/V chemical fields off the main thread and returns
 * 4-channel cell outputs via zero-copy Transferable ArrayBuffer ping-ponging.
 */

import type { UniformValue } from '../../../registry/types';
import { GrayScottSimulation } from './grayScottKernel';

export type ReactionDiffusionWorkerInMessage =
  | { readonly type: 'init'; readonly cols: number; readonly rows: number; readonly seed: number }
  | { readonly type: 'resize'; readonly cols: number; readonly rows: number }
  | { readonly type: 'reset'; readonly seed: number }
  | { readonly type: 'drop'; readonly gridX: number; readonly gridY: number; readonly radius?: number }
  | {
      readonly type: 'step';
      readonly dt: number;
      readonly params: Readonly<Record<string, UniformValue>>;
      readonly recycledBuffer?: ArrayBuffer;
    };

export type ReactionDiffusionWorkerOutMessage = {
  readonly type: 'frame';
  readonly cols: number;
  readonly rows: number;
  readonly buffer: ArrayBuffer;
};

let simulation: GrayScottSimulation | null = null;
let transferBuffer: ArrayBuffer | null = null;

function ensureTransferBuffer(byteLength: number): ArrayBuffer {
  if (!transferBuffer || transferBuffer.byteLength < byteLength) {
    transferBuffer = new ArrayBuffer(byteLength);
  }
  const buf = transferBuffer;
  transferBuffer = null;
  return buf;
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = (event: MessageEvent<ReactionDiffusionWorkerInMessage>): void => {
    const msg = event.data;
    switch (msg.type) {
      case 'init':
        simulation = new GrayScottSimulation(msg.cols, msg.rows, msg.seed);
        break;
      case 'resize':
        simulation?.resize(msg.cols, msg.rows);
        break;
      case 'reset':
        simulation?.reset(msg.seed);
        break;
      case 'drop':
        simulation?.injectDrop(msg.gridX, msg.gridY, msg.radius ?? 3);
        break;
      case 'step': {
        if (!simulation) return;
        if (msg.recycledBuffer) {
          transferBuffer = msg.recycledBuffer;
        }
        simulation.step(msg.dt, msg.params);
        const cols = simulation.getCols();
        const rows = simulation.getRows();
        const byteLength = cols * rows * 4 * Float32Array.BYTES_PER_ELEMENT;
        const outBuf = ensureTransferBuffer(byteLength);
        const outView = new Float32Array(outBuf, 0, cols * rows * 4);
        simulation.writeCellField(outView);

        const reply: ReactionDiffusionWorkerOutMessage = {
          type: 'frame',
          cols,
          rows,
          buffer: outBuf,
        };
        (self as unknown as { postMessage: (m: unknown, transfer: Transferable[]) => void }).postMessage(
          reply,
          [outBuf]
        );
        break;
      }
    }
  };
}
