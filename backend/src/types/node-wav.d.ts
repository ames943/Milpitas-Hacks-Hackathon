declare module 'node-wav' {
  interface WavData {
    /** PCM samples normalized to [-1, 1], one Float32Array per channel. */
    channelData: Float32Array[];
    sampleRate: number;
    bitDepth: number;
  }
  export function decode(buffer: Buffer): WavData;
  export function encode(
    channelData: Float32Array[],
    options: { sampleRate: number; float?: boolean; bitDepth?: number },
  ): Buffer;
}
