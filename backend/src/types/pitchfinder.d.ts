declare module 'pitchfinder' {
  type PitchDetector = (samples: Float32Array | number[]) => number | null;

  interface YINOptions {
    sampleRate: number;
    threshold?: number;
    probabilityThreshold?: number;
    bufferSize?: number;
  }
  interface AMDFOptions {
    sampleRate: number;
    minFrequency?: number;
    maxFrequency?: number;
    sensitivity?: number;
    ratio?: number;
  }

  export function YIN(options: YINOptions): PitchDetector;
  export function AMDF(options: AMDFOptions): PitchDetector;
  export function DynamicWavelet(options: { sampleRate: number }): PitchDetector;
  export function ACF2PLUS(options: { sampleRate: number }): PitchDetector;
}
