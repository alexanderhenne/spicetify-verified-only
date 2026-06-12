# Contributing

## Community allowlist

`community-allowed.json` is a curated list of artists who are demonstrably real
people or groups but don't (yet) have the Verified by Spotify badge. The extension
ships it to all users, so entries are reviewed before merging.

**To suggest an artist**, either:

- open an [allowlist request](../../issues/new?template=community-allowlist-request.yml), or
- send a pull request adding the artist to `community-allowed.json`
  (`"spotify:artist:<id>": "Artist Name"`, keep the list alphabetical by name)
  with the evidence in the PR description.

**Criteria.** An entry needs evidence of a real-world presence from independent
sources: live performance footage, interviews, press coverage, a label page, or
social accounts with genuine history. "Has music on Spotify" is not evidence -
the old Registered checkmark is held by AI acts too.

Entries become inert once Spotify verifies the artist (the list is only consulted
when the badge check fails), so there is no need to remove entries that get the
badge later.

## Code

Bug reports and PRs welcome. The extension is plain JavaScript with no build
step; `node --check` both files before submitting.
