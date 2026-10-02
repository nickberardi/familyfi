# Connect to FamilyFi

You are an agent helping a household manage its internet through FamilyFi {{version}}, served at
`{{origin}}`. FamilyFi controls a UniFi gateway: it blocks or allows internet, categories, apps and
websites for the household's people and things, always or in named time windows. Follow these
steps in order, then help the person who gave you this guide.

## 1. Connect

The person gave you a **pairing code** with this guide. It is single-use and expires 15 minutes after it was
made. If it has expired or does not work, ask them for a new one: they make it on the **API** page
of the FamilyFi web app, under **Connect an agent**.

The code is base64url JSON. Decode it to get `url` (where FamilyFi is) and `code`:

```sh
python3 -c 'import base64,json,sys; s=sys.argv[1]; print(json.dumps(json.loads(base64.urlsafe_b64decode(s+"="*(-len(s)%4))), indent=2))' '<pairing code>'
```

The `code` is `<pairingId>.<token>`. Claim it; you never need a password:

```sh
curl -sS -X POST "$url/api/v1/connection/pairings/<pairingId>/claim" -H 'content-type: application/json' \
  -d '{"token":"<token>","deviceName":"<your name, e.g. Claude Code on a MacBook>"}'
```

The response holds:

- `token`: your bearer. It lasts **one hour** (`session.expiresAt`).
- `refreshToken`: what renews it. It lasts 90 days from its last use.
- `device.id` and `device.grant`.

Keep them where your environment keeps secrets, for example:

```sh
export FAMILYFI_URL="$url" FAMILYFI_DEVICE_ID="<device.id>" FAMILYFI_REFRESH_TOKEN="<refreshToken>" FAMILYFI_TOKEN="<token>"
```

**Never print, log or repeat the refresh token or bearer** to the person or in files you commit.
Send `Authorization: Bearer $FAMILYFI_TOKEN` on every request.

When a request answers `401`, or the hour is nearly up, renew:

```sh
curl -sS -X POST "$FAMILYFI_URL/api/v1/auth/refresh" -H 'content-type: application/json' \
  -d "{\"refreshToken\":\"$FAMILYFI_REFRESH_TOKEN\"}"
```

It returns a new `token` **and a new `refreshToken`**:

- **Always save the new refresh token at once.** The one you sent is spent.
- Sending a spent refresh token again ends your access, because it looks like a stolen copy.
- If refresh answers `403` with `invalid_refresh` or `refresh_reused`, your access has ended. That happens when you were disconnected, unused for 90 days, or reused a spent token. Ask the person for a new pairing code. (`agent_remote` only means you are not on the home network.)

FamilyFi refuses agents that come through its remote access tunnel, which is for the household's phones.
Connect from the home network.

## 2. Learn the API

- `GET {{origin}}/openapi` (with your bearer) returns the OpenAPI 3.1 contract. It is the authority
  on paths, bodies and responses; read it before calling anything not shown here.
- `GET /api/v1/auth/session` says whose account you act as: the adult who paired you.
- `GET /api/v1/settings/household` gives the household `timezone`. Read and write times in it.

## 3. The household model

- A **group** holds network controls for a person (`kind: family`) or a collection of things
  (`kind: things`). `GET /api/v1/groups`.
- A **device** is a network client. A device in no group is **quarantined**. Assign one with
  `PUT /api/v1/devices/{mac}/assignment` and `{ "groupId": "…" }`.
- A **rule** blocks all internet (`kind: internet`), a category, apps or websites for one or more
  groups, always or in named **windows**. `GET /api/v1/rules?groupId=…`.
- Every group has a built-in rule whose id is `internet`.

## 4. Changing things

| To | Call |
| --- | --- |
| Block a group's internet now ("pause") | `POST /api/v1/groups/{id}/rules/internet/pause` with `{ "until": "<ISO time>" }` or `{}` for until resumed |
| End that pause | `POST /api/v1/groups/{id}/rules/internet/resume` |
| Add time to a timed pause | `POST …/extend` with `{ "minutes": 30 }` |
| Let a group online despite its internet rules ("allow") | `POST /api/v1/groups/{id}/rules/internet/allow` with optional `{ "until": … }` |
| End that allowance | `POST …/disallow` |
| The same for one rule, for every group it covers | `POST /api/v1/rules/{id}/(pause\|resume\|extend\|allow\|disallow)` |

Pause, resume and extend act on a pause; allow and disallow act on an allowance. They mean the same
at every scope.

A write that changes the gateway answers with a `change` (`changeId`, `revision`). Saving is not
enforcement: poll `GET /api/v1/changes/{changeId}` until it settles, and tell the person if it
failed. A successful household sync is not proof that your change applied.

## 5. Behave like a good household guest

- **Confirm with the person before you pause someone's internet, delete anything, or change a rule.**
  Say who it affects and until when, in the household timezone.
- Prefer the smallest change that does what was asked, and offer to undo it.
- DNS categories (`/api/v1/upstream/…`) report what an upstream resolver filters. They never
  enforce anything. A verdict of `unknown` means FamilyFi could not look; never call it open.

## 6. What you cannot do

Your grant is in `device.grant`:

- `read`: you may only read household state.
- `controls`: you may also manage groups, rules, pauses, allowances, devices and their
  assignment, sync and DNS categories.

Under any grant, you cannot reach accounts, gateway settings or resolvers, change household settings,
or manage pairing, remote access or paired devices. These answer:

| Status | `error.code` | Meaning |
| --- | --- | --- |
| 403 | `agent_scope` | Your grant does not cover this. Ask the person to do it in the web app at `{{origin}}`. |
| 403 | `agent_remote` | You reached FamilyFi through remote access. Connect from the home network. |
| 401 | `unauthenticated` | Your bearer expired. Renew it with your refresh token (step 1). |
| 403 | `invalid_refresh`, `refresh_reused` | From refresh: your access has ended. Ask for a new pairing code. |

To disconnect yourself, `DELETE /api/v1/connection/devices/$FAMILYFI_DEVICE_ID`.

Background on FamilyFi: <https://github.com/nickberardi/familyfi>.
