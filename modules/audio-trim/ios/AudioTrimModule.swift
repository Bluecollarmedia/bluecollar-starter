import ExpoModulesCore
import AVFoundation

/// Cuts an audio file (or the sound of a video) down to [startSeconds, endSeconds] and saves it as a small AAC .m4a in the temporary folder.
/// Resolves with the new file's address (file://...). Rejects with a plain message when it cannot be done; the app then sends the whole track instead.
public final class AudioTrimModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AudioTrim")

    AsyncFunction("trim") { (inputPath: String, startSeconds: Double, endSeconds: Double, promise: Promise) in
      let withoutScheme = inputPath.hasPrefix("file://") ? String(inputPath.dropFirst("file://".count)) : inputPath
      let decoded = withoutScheme.removingPercentEncoding ?? withoutScheme
      let inputURL = URL(fileURLWithPath: decoded)

      guard FileManager.default.fileExists(atPath: inputURL.path) else {
        promise.reject("E_TRIM_NO_FILE", "The track file was not found.")
        return
      }
      guard endSeconds > startSeconds, startSeconds >= 0 else {
        promise.reject("E_TRIM_RANGE", "The chosen part is not valid.")
        return
      }

      let asset = AVURLAsset(url: inputURL)
      guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
        promise.reject("E_TRIM_SESSION", "This track cannot be cut on this phone.")
        return
      }

      let outputURL = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("\(UUID().uuidString).m4a")
      session.outputURL = outputURL
      session.outputFileType = .m4a
      session.timeRange = CMTimeRange(
        start: CMTime(seconds: startSeconds, preferredTimescale: 600),
        end: CMTime(seconds: endSeconds, preferredTimescale: 600)
      )

      session.exportAsynchronously {
        if session.status == .completed {
          promise.resolve(outputURL.absoluteString)
        } else {
          promise.reject("E_TRIM_FAILED", session.error?.localizedDescription ?? "The track could not be cut.")
        }
      }
    }
  }
}
