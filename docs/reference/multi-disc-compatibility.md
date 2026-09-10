# Multi-Disc Game Compatibility

The primary compatibility reference is the retail-disc table maintained by
[Iso2God by r4dius](https://github.com/r4dius/Iso2God#compatibility--installation-notes).
Title IDs are cross-checked against the embedded `iso2god_titles.jsonl` catalog.

## Authoritative detection

The compatibility table is only a pre-download hint. Once an ISO is available,
the server inspects its XDVDFS tree:

- A populated `Content/0000000000000000/<TitleID>/00000002` or `FFFFFFFF`
  tree is installed as Content.
- A playable/continuation disc without that tree is converted to GOD.
- The parent Title ID is read from an embedded LIVE/PIRS/CON package whenever
  possible, so a placeholder `FFED2000` XEX cannot select the destination.
- Unknown Disc 2+ entries default to GOD before download. They are never
  assumed to be content merely because of their disc number.
- Every generated GOD is accepted only after its LIVE header and complete
  MHT/SHT/data hash chain validate.

This structure-based decision covers catalog titles that are not present in a
manual table and protects region/revision variants with different filenames.

## Releases that ship as one archive

A XEX rip usually packs the whole release into a single archive, with one folder per
disc (`Disc1`, `Disc2`). The playable folder is the one holding `default.xex`; every
`Content/0000000000000000/<TitleID>/<type>` tree beside it is an install disc and is
written to the destination as well, before the game. The parent Title ID comes from the
package header rather than the folder name, because a retail installer addresses its own
tree under `FFED2000`.

Because such a folder is named after the disc and not the game, the destination folder
takes the release title instead — otherwise the console lists the title as `Disc2`.

## When the set cannot be completed

Discs of one release are recognised as siblings by release title, after the disc number
and the disc-role group are stripped. Role groups are free text in the catalogs
(`(Single-Player Campaign)`, `(Install-Multiplayer)`, `[DLC]`), so a group is treated as a
role whenever it contains a role keyword; the region, language and edition groups that tell
two releases apart carry none and stay in the title.

About a third of the multi-disc rows still have no sibling: the companion exists only under
a different region variant, or not at all. `Alien - Isolation (USA) (Disc 2)` has its Disc 1
only as `(USA, Europe)`. Matching across those would install the wrong disc, so the queue
flags every disc of that release instead and the delivery message names the missing disc.

## Verified content/install discs

| Game | Title ID | Disc installed as Content |
|---|---:|---:|
| Alien: Isolation | `5345085E` | Disc 1 |
| Batman: Arkham City GOTY | `57520802` | Disc 2 |
| Batman: Arkham Origins | `57520828` | Disc 2 |
| Battlefield 4 | `454109BA` | Disc 1 |
| BioShock | `545407D8` | Bonus Disc 2 |
| BioShock 2 | `54540861` | Bonus Disc 2 |
| BioShock Infinite | `5454085D` | Bonus Disc 2 |
| Call of Duty: Advanced Warfare | `41560914` | Disc 2 |
| Call of Duty: Ghosts | `415608FC` | Disc 2 |
| Dark Souls II: Scholar of the First Sin | `465307E4` | Disc 2 |
| Dishonored GOTY | `425307E3` | Disc 2 |
| Dragon's Dogma: Dark Arisen | `43430814` | Disc 2 |
| The Elder Scrolls IV: Oblivion GOTY | `425307D1` | Disc 2 |
| The Elder Scrolls V: Skyrim Legendary Edition | `425307E6` | Disc 2 |
| Fallout 3 GOTY | `425307D5` | Disc 2 |
| Fallout: New Vegas Ultimate Edition | `425307E0` | Disc 2 |
| Forza Motorsport 2 | `4D5307EA` | Bonus Disc 2 |
| Forza Motorsport 3 | `4D53084D` | Content Install Disc 2 |
| Forza Motorsport 4 | `4D530910` | Content Install Disc 2 |
| Grand Theft Auto V | `545408A7` | Disc 1 |
| Mafia II | `545407E6` | Bonus Disc 2 |
| Mass Effect | `4D5307E8` | Bonus Disc 2 |
| Metal Gear Solid V: The Phantom Pain | `4B4E085E` | Disc 1 |
| Saints Row: The Third — The Full Package | `5451086D` | Disc 1 |
| Saints Row IV — National Treasure Edition | `4B4D07F6` | Disc 1 |

Content is written to:

```text
<Drive>/Content/0000000000000000/<TitleID>/00000002/
```

Retail installers using `FFED2000/FFFFFFFF` are normalized to the same path.

## Playable continuation and special cases

- Blue Dragon, Dead Space 2, Dead Space 3, Final Fantasy XIII, Lost Odyssey,
  The Last Remnant, and Wolfenstein: The New Order use playable GOD discs.
- Alien: Isolation, Battlefield 4, Grand Theft Auto V, Metal Gear Solid V, and
  the Saints Row editions above put installation data on Disc 1 and the
  playable game on Disc 2.
- Splinter Cell Blacklist Disc 2 is mixed: it is playable as GOD and also has
  embedded content. The GOD path is retained to avoid losing the playable disc.
- Assassin's Creed IV: Black Flag Disc 2 is explicitly No-GOD and is routed to
  XEX extraction as a multiplayer disc.
- Watch Dogs requires a custom combined layout and cannot be represented by a
  normal one-disc GOD/content decision; isolated Disc 2 jobs are blocked.
- Tetris: The Grand Master Ace (`434107D2`) must retain game-partition padding;
  it is the documented exception to full padding removal.

These special cases need physical-console testing when new media revisions are
added, even though structural and hash validation is automatic.
