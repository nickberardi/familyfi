# Watch session

The session code a paired watch runs to talk to FamilyFi by itself: how it trusts the household (the
signed manifest, pinned routes, Access credentials), the session the phone hands it and how it keeps
it, and the `/api/v1` client that renews its bearer and fails over between routes. It mirrors the
phone's TypeScript (`src/lib/companion-trust.ts`, `companion-request.ts`, `companion-session.ts`), and
the phone builds what it hands over with `enrollWatch` and `watchProvisioning` (`src/lib/watch.ts`).

It is not an Expo module: watch apps cannot run one. Each app's watch target links these sources.

| Folder | Platform | Files |
| --- | --- | --- |
| `apple` | watchOS (and any Apple target holding its own session) | `FFTrust.swift`, `FFSession.swift`, `FFDeviceClient.swift` |
| `android` | Wear OS, package `com.getfamilyfi.watchsession` | `Trust.kt`, `DeviceClient.kt`, `SecureStore.kt` |

- An Apple target links each file from its folder (a symbolic link into `vendor/familyfi`), and adds
  the calls its scope allows in an extension of `FFDeviceClient`, over its `get`, `post` and `send`.
- A Wear OS app adds `android/src/main/java` to its source set, with OkHttp and Tink, and keeps its
  session in an `FFSecureStore` under its own preferences name and key alias.

FamilyFi Me's watch (`me-watch`) uses it first; the FamilyFi app's Watch, Siri actions and Wear OS
app move onto it from their own copies in familyfi-mobile, which these began as.
