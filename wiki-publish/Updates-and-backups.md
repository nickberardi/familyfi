# Updates and backups

## Updates

When a new version is out, **Update available** appears at the bottom of the menu. It opens the **Update** page, with what's new and an **Install** button.

**Install** backs up the database, then replaces FamilyFi with the new version; the page reports how it went. If the backup fails, the update is skipped and FamilyFi keeps running the version it has.

**Automatic updates** installs new versions on a schedule, Sunday at midnight unless you change the days and time. Your gateway keeps enforcing your rules while FamilyFi restarts.

You can skip versions: any version updates straight to the newest.

### Updating by hand

The Install button uses the small `watchtower` container that the Compose file starts alongside FamilyFi. To update without it, run this in the FamilyFi folder:

```bash
docker compose pull app
docker compose up -d
```

## Backups

FamilyFi keeps everything in Docker volumes on the FamilyFi computer: the database, and a file holding the key that encrypts your UniFi API key. Two kinds of backup cover you.

### Export your household

**Settings → Backup** downloads a single file with your groups, rules, schedules, device assignments, accounts and settings. To restore, use **Import** there, or **Restore from an export** during [first-time setup](First-time-setup) on a new install.

An export never contains your UniFi API key, tunnel credentials, or paired phones. After restoring on a new install, paste your UniFi key again if asked, turn remote access back on, and pair your phones again.

Keep a recent export somewhere other than the FamilyFi computer.

### Automatic backups before updates

Each update saves a full database backup first, inside FamilyFi's data volume, and keeps the newest three. These can restore everything, including paired phones and history, on the same install. The [operations reference](https://github.com/nickberardi/familyfi/blob/main/docs/operations.md#backup-and-restore) has the commands.

### Don't delete the volumes

`docker compose stop`, `docker compose down` and rebooting are all safe. **`docker compose down -v` deletes your household**, so don't use `-v` unless you mean to start over.
