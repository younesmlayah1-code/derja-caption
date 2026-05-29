declare module "@ffmpeg/core" {
  type FFmpegCoreOptions = Record<string, unknown>;
  type FFmpegCore = Record<string, unknown>;

  const createFFmpegCore: (options?: FFmpegCoreOptions) => Promise<FFmpegCore>;
  export default createFFmpegCore;
}