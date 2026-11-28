/**
 * Web Audio API 4-Band Spectral Analyzer for Generative ASCII Styles.
 * Supports live microphone streams (`getUserMedia`) and local audio files
 * routed through `AnalyserNode`, computing smoothed `[0..1]` energy for
 * `subBass`, `lowMid`, `highMid`, `treble`, plus overall RMS amplitude.
 */

export type AudioSourceKind = 'none' | 'mic' | 'file';

export interface AudioAnalyzerState {
  readonly active: boolean;
  readonly source: AudioSourceKind;
  readonly label: string | null;
  readonly rms: number;
}

export type AudioBandsTuple = readonly [number, number, number, number];

export class AudioAnalyzer {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private micStream: MediaStream | null = null;
  private micNode: MediaStreamAudioSourceNode | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private audioElUrl: string | null = null;
  private fileNode: MediaElementAudioSourceNode | null = null;

  private freqData = new Uint8Array(0);
  private timeData = new Uint8Array(0);
  private smoothedBands: [number, number, number, number] = [0, 0, 0, 0];
  private smoothedRms = 0;

  private rafId: number | null = null;
  private source: AudioSourceKind = 'none';
  private label: string | null = null;
  private onUpdate: ((bands: AudioBandsTuple, rms: number) => void) | null = null;

  public getState(): AudioAnalyzerState {
    return {
      active: this.source !== 'none',
      source: this.source,
      label: this.label,
      rms: this.smoothedRms,
    };
  }

  public async startMicrophone(
    onBands: (bands: AudioBandsTuple, rms: number) => void
  ): Promise<AudioAnalyzerState> {
    this.stop();
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone audio capture is unavailable in this browser.');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
      },
      video: false,
    });

    const ctx = this.ensureContext();
    await ctx.resume().catch(() => {});

    const analyser = this.createAnalyser(ctx);
    const micNode = ctx.createMediaStreamSource(stream);
    micNode.connect(analyser);

    this.micStream = stream;
    this.micNode = micNode;
    this.analyser = analyser;
    this.source = 'mic';
    this.label = 'Microphone';
    this.onUpdate = onBands;
    this.startLoop();

    return this.getState();
  }

  public async startAudioFile(
    file: File,
    onBands: (bands: AudioBandsTuple, rms: number) => void
  ): Promise<AudioAnalyzerState> {
    this.stop();
    if (typeof window === 'undefined') {
      throw new Error('Audio playback is only available in browser environments.');
    }

    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.src = url;
    audio.loop = true;
    audio.preload = 'auto';

    await new Promise<void>((resolve, reject) => {
      audio.onloadeddata = () => resolve();
      audio.onerror = () => reject(new Error(`Unable to decode audio file: ${file.name}`));
    }).catch((err: unknown) => {
      URL.revokeObjectURL(url);
      throw err;
    });

    const ctx = this.ensureContext();
    await ctx.resume().catch(() => {});

    const analyser = this.createAnalyser(ctx);
    const fileNode = ctx.createMediaElementSource(audio);
    fileNode.connect(analyser);
    analyser.connect(ctx.destination);

    await audio.play().catch(() => {});

    this.audioEl = audio;
    this.audioElUrl = url;
    this.fileNode = fileNode;
    this.analyser = analyser;
    this.source = 'file';
    this.label = file.name;
    this.onUpdate = onBands;
    this.startLoop();

    return this.getState();
  }

  public stop(): AudioAnalyzerState {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    this.micNode?.disconnect();
    this.micNode = null;
    if (this.micStream) {
      for (const track of this.micStream.getTracks()) {
        track.stop();
      }
      this.micStream = null;
    }

    this.fileNode?.disconnect();
    this.fileNode = null;
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.src = '';
      this.audioEl = null;
    }
    if (this.audioElUrl) {
      URL.revokeObjectURL(this.audioElUrl);
      this.audioElUrl = null;
    }

    this.analyser?.disconnect();
    this.analyser = null;
    this.source = 'none';
    this.label = null;
    this.smoothedBands = [0, 0, 0, 0];
    this.smoothedRms = 0;

    const cb = this.onUpdate;
    this.onUpdate = null;
    cb?.([0, 0, 0, 0], 0);

    return this.getState();
  }

  public dispose(): void {
    this.stop();
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      void this.audioCtx.close().catch(() => {});
    }
    this.audioCtx = null;
  }

  private ensureContext(): AudioContext {
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      return this.audioCtx;
    }
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { readonly webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) {
      throw new Error('Web Audio API is unsupported in this browser.');
    }
    this.audioCtx = new AudioCtx();
    return this.audioCtx;
  }

  private createAnalyser(ctx: AudioContext): AnalyserNode {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.72;
    this.freqData = new Uint8Array(analyser.frequencyBinCount);
    this.timeData = new Uint8Array(analyser.fftSize);
    return analyser;
  }

  private startLoop(): void {
    const tick = (): void => {
      if (this.source === 'none' || !this.analyser || !this.audioCtx) return;

      this.analyser.getByteFrequencyData(this.freqData);
      this.analyser.getByteTimeDomainData(this.timeData);

      const hzPerBin = this.audioCtx.sampleRate / this.analyser.fftSize;
      const subBass = this.bandEnergy(20, 120, hzPerBin);
      const lowMid = this.bandEnergy(120, 500, hzPerBin);
      const highMid = this.bandEnergy(500, 2500, hzPerBin);
      const treble = this.bandEnergy(2500, 12000, hzPerBin);

      const attack = 0.55;
      const release = 0.18;
      const raw: readonly [number, number, number, number] = [
        subBass,
        lowMid,
        highMid,
        treble,
      ];
      for (let i = 0; i < 4; i += 1) {
        const target = raw[i] ?? 0;
        const prev = this.smoothedBands[i] ?? 0;
        const alpha = target >= prev ? attack : release;
        this.smoothedBands[i] = prev + (target - prev) * alpha;
      }

      let sumSq = 0;
      for (let i = 0; i < this.timeData.length; i += 1) {
        const centered = ((this.timeData[i] ?? 128) - 128) / 128;
        sumSq += centered * centered;
      }
      const rawRms = Math.min(
        1,
        Math.sqrt(sumSq / Math.max(1, this.timeData.length)) * 2.2
      );
      this.smoothedRms += (rawRms - this.smoothedRms) * 0.35;

      this.onUpdate?.(
        [
          this.smoothedBands[0],
          this.smoothedBands[1],
          this.smoothedBands[2],
          this.smoothedBands[3],
        ],
        this.smoothedRms
      );

      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  private bandEnergy(minHz: number, maxHz: number, hzPerBin: number): number {
    const binCount = this.freqData.length;
    if (binCount === 0 || hzPerBin <= 0) return 0;

    const startBin = Math.max(0, Math.floor(minHz / hzPerBin));
    const endBin = Math.min(binCount - 1, Math.ceil(maxHz / hzPerBin));
    if (endBin < startBin) return 0;

    let sum = 0;
    let peak = 0;
    const count = endBin - startBin + 1;
    for (let i = startBin; i <= endBin; i += 1) {
      const val = (this.freqData[i] ?? 0) / 255;
      sum += val;
      if (val > peak) peak = val;
    }
    const mean = sum / count;
    return Math.min(1, mean * 0.65 + peak * 0.45);
  }
}
