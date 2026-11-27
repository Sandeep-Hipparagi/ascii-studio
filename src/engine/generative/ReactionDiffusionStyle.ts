/**
 * Gray-Scott Reaction-Diffusion Worker-Grid Style Plugin.
 * Supports Mitosis, Coral, Spirals, and Maze Turing pattern presets, interactive
 * pointer perturbations (`injectDrop`), and zero-copy Transferable Worker stepping.
 */

import type { UniformValue, WorkerGridStylePlugin } from '../../registry/types';
import { GrayScottSimulation } from './workers/grayScottKernel';
import type {
  ReactionDiffusionWorkerInMessage,
  ReactionDiffusionWorkerOutMessage,
} from './workers/reactionDiffusion.worker';

export { GRAY_SCOTT_PRESETS, GrayScottSimulation } from './workers/grayScottKernel';

/**
 * Asynchronous zero-copy Transferable bridge around `reactionDiffusion.worker.ts`.
 * Falls back cleanly to `GrayScottSimulation` in environments without `Worker`.
 */
export class ReactionDiffusionWorkerBridge {
  private worker: Worker | null = null;
  private latestFrame: Float32Array | null = null;
  private recycledBuffer: ArrayBuffer | null = null;
  private pendingStep = false;

  public constructor(cols: number, rows: number, seed = 1337) {
    if (typeof Worker !== 'undefined') {
      this.worker = new Worker(
        new URL('./workers/reactionDiffusion.worker.ts', import.meta.url),
        { type: 'module' }
      );
      this.worker.onmessage = (
        event: MessageEvent<ReactionDiffusionWorkerOutMessage>
      ): void => {
        this.pendingStep = false;
        const msg = event.data;
        if (msg.type === 'frame') {
          if (this.latestFrame && this.latestFrame.buffer !== msg.buffer) {
            this.recycledBuffer = this.latestFrame.buffer as ArrayBuffer;
          }
          this.latestFrame = new Float32Array(msg.buffer, 0, msg.cols * msg.rows * 4);
        }
      };
      this.post({ type: 'init', cols, rows, seed });
    }
  }

  public resize(cols: number, rows: number): void {
    this.post({ type: 'resize', cols, rows });
  }

  public reset(seed: number): void {
    this.post({ type: 'reset', seed });
  }

  public injectDrop(gridX: number, gridY: number, radius = 3): void {
    this.post({ type: 'drop', gridX, gridY, radius });
  }

  public requestStep(dt: number, params: Readonly<Record<string, UniformValue>>): void {
    if (!this.worker || this.pendingStep) return;
    this.pendingStep = true;
    const recycled = this.recycledBuffer ?? undefined;
    this.recycledBuffer = null;

    const msg: ReactionDiffusionWorkerInMessage = {
      type: 'step',
      dt,
      params,
      recycledBuffer: recycled,
    };
    if (recycled) {
      this.worker.postMessage(msg, [recycled]);
    } else {
      this.worker.postMessage(msg);
    }
  }

  public getLatestField(): Float32Array | null {
    return this.latestFrame;
  }

  public dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.latestFrame = null;
    this.recycledBuffer = null;
  }

  private post(message: ReactionDiffusionWorkerInMessage): void {
    this.worker?.postMessage(message);
  }
}

export const ReactionDiffusionStyle: WorkerGridStylePlugin = {
  mode: 'generative',
  executionMode: 'worker-grid',
  id: 'reaction-diffusion',
  name: 'Reaction-Diffusion',
  category: 'reaction-diffusion',
  description:
    'Gray-Scott coupled reaction-diffusion PDEs with 9-point Laplacian, toroidal boundaries, and interactive chemical seeding.',
  defaultRamp: 'dense',
  supportsDirectionalGlyphs: false,
  fixedTimestepHz: 60,
  uniformSchema: [
    {
      id: 'preset',
      uniformName: 'u_preset',
      label: 'Pattern Preset',
      kind: 'select',
      group: 'simulation',
      options: [
        { value: 'mitosis', label: 'Mitosis' },
        { value: 'coral', label: 'Coral' },
        { value: 'spirals', label: 'Spirals' },
        { value: 'maze', label: 'Maze' },
      ],
      default: 'coral',
    },
    {
      id: 'stepsPerFrame',
      uniformName: 'u_stepsPerFrame',
      label: 'Sub-Steps / Frame',
      kind: 'slider',
      group: 'simulation',
      min: 1,
      max: 24,
      step: 1,
      default: 8,
    },
    {
      id: 'diffusionU',
      uniformName: 'u_diffusionU',
      label: 'Diffusion U',
      kind: 'slider',
      group: 'simulation',
      min: 0.05,
      max: 0.24,
      step: 0.01,
      default: 0.2,
    },
    {
      id: 'diffusionV',
      uniformName: 'u_diffusionV',
      label: 'Diffusion V',
      kind: 'slider',
      group: 'simulation',
      min: 0.02,
      max: 0.2,
      step: 0.01,
      default: 0.1,
    },
  ] as const,

  createSimulation(cols: number, rows: number, seed: number): GrayScottSimulation {
    return new GrayScottSimulation(cols, rows, seed);
  },
};
