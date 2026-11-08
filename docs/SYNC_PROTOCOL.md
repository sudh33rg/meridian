# Mobile sync protocol (Phase L2)

Status: in force for the Flutter companion app (`apps/mobile`). Synchronisation happens only when a
person opens a screen or presses a button. There is no background sync and no push.

## Reads

- The issue list is read in full: every page, following `X-Next-Cursor` (`Api.requestAllPages`).
- The last issue list read for each project is cached on the device (up to 500 issues). If a read fails
  because the device is offline, the cached list is shown with the note "Offline. Showing issues from your
  last sync." Nothing else is cached.
- Each read is the server's current state. A cached list is never written back to the server.

## Creating issues offline (drafts)

- A new issue written offline is kept as a draft on the device with an `Idempotency-Key` created at
  the time of writing (32 random hex characters).
- Sending a draft repeats the create with the same key. The server replays the original issue if an
  earlier attempt already created it, so a retry cannot duplicate work. A draft that fails stays in the
  list with the reason.
- Up to 30 drafts are kept.

## Changing an issue (conflicts)

- Every issue read returns an `ETag`. A change to an issue (status, for example) sends that ETag as
  `If-Match`.
- If the issue changed since the device loaded it, the server answers `412 Precondition Failed`.
  The app reloads the issue and shows what is there now, with two choices: keep the latest version,
  or apply the person's change on top of it. The change is never applied silently.
- A change to a field that the device did not send is not a conflict; only the sent field is written.

## Comments

- A comment is appended. Two comments never conflict. A comment that fails to post stays in the
  text box so it can be sent again.

## Not covered

- Offline editing of existing issues: a change needs the server, so it is refused while offline.
- Background synchronisation, push and automatic retries (these depend on the owner's choice of push
  provider, see the plan item L3).
- Conflict review for comments, and for fields other than status.
