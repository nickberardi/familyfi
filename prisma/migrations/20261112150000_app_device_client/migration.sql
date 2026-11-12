-- A paired phone, tablet or Mac is the app, whatever it runs on: `phone` becomes `app`. Its Siri,
-- Shortcuts and system controls pair as the same client with the rulesOnly scope, so no new value.
ALTER TYPE "PairedDeviceClient" RENAME VALUE 'phone' TO 'app';
