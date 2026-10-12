# First-time setup

The first time you open FamilyFi, it walks you through setup. Everything you choose here can be changed later in **Settings** and **Rules**.

> Setup is open to anyone on your home network until you save a gateway key, so finish it soon after installing.

## 1. Save the admin password

Setup shows the password for the built-in **admin** account. Copy it into your password manager, tick **I've saved this password**, and continue; FamilyFi signs you in with it.

## 2. Connect your gateway

FamilyFi needs an API key from UniFi to add and remove its own rules.

1. In **UniFi Network**, open **Settings → Control Plane → Integrations** and create an API key.
2. In FamilyFi, enter your gateway's address (for example `192.168.1.1`) and paste the key.
3. Only fill in **Site ID** if your console manages more than one site.

FamilyFi checks the connection and shows **Connected to UniFi Network** when it works. It accepts your console's self-signed certificate. The key is stored encrypted, and FamilyFi never creates or changes keys in UniFi.

Moving from another FamilyFi install? Open **Restore from an export** on this step instead (see [Updates and backups](Updates-and-backups)).

## 3. Pick networks to watch

Choose the networks (VLANs) your family's devices use, such as your main and kids' networks. FamilyFi only looks at devices on these networks; everything else, like a separate network for servers or cameras, is ignored.

## 4. Add your household

Add each person and whether they're an adult, teen or child. Teens and children get rules and schedules; they never sign in. Adults can be made administrators later in **Settings**, and only administrators can use FamilyFi.

## 5. Suggested schedules

FamilyFi suggests common starting points for teens and children, such as bedtime and school nights. Turn on the ones that fit; you can adjust the times later on **Rules**.

## Next steps

1. **Check the time zone.** In **Settings**, make sure the household time zone matches your UniFi console's, so a 9 PM bedtime starts at 9 PM.
2. **Assign devices.** Open **Devices** and put each phone, tablet and computer in the right group. See [Family, Things and devices](Family-Things-and-devices).
3. **Add personal accounts** for the adults who will manage FamilyFi, in **Settings**, so nobody has to share the admin password.
4. **Pair your phone** if you want the app. See [Phone and Watch app](Phone-and-Watch-app).
