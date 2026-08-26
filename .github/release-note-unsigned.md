> **This build is not signed or notarized by Apple.** macOS refuses to open it
> the first time, and the dialog it shows ("damaged and can't be opened") does
> not say why. Right-click the app and choose **Open**, or run:
>
> ```
> xattr -dr com.apple.quarantine /Applications/MetalcraftFront.app
> ```

