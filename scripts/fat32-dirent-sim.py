"""Replay copyLocalEntry's create-temp-then-rename sequence on a model of the fastfat dirent allocator.

Diagnostic for docs/bugs/open/pipeline-gravacao-local-fragmenta-pasta-fat32-ate-o-limite-de-65536-entradas-e-o-rename-falha_2026-10-09T12-00.md

Model taken from microsoft/Windows-driver-samples filesys/fastfat:
  dirsup.c::FatCreateNewDirent  1) never-used space inside the current allocation (UnusedDirentVbo),
                                2) else first run of N clear bits from DeletedDirentHint (RtlFindClearBits, wraps),
                                3) else grow one cluster, unless allocation is already 64K dirents -> STATUS_CANNOT_MAKE.
  dirsup.c::FatDeleteDirent     clears the bits; moves DeletedDirentHint back to the freed run.
  fileinfo.c::FatSetRenameInfo  same directory and same dirent count -> rewrite in place;
                                otherwise FatCreateNewDirent for the NEW name first, delete the old dirents after.

Usage: python -I scripts/fat32-dirent-sim.py <zip> <dir inside zip> <cluster bytes>
"""
import math
import sys
import zipfile

CAP = 65536
INVALID_83 = set('"*+,/:;<=>?[\\]| ')


def dirents(name):
    if name.count(".") <= 1 and not name.startswith("."):
        base, _, ext = name.partition(".")
        fits = 1 <= len(base) <= 8 and len(ext) <= 3 and not (set(name) & INVALID_83) and name.isascii()
        if fits and all(s == s.upper() or s == s.lower() for s in (base, ext)):
            return 1
    return 1 + math.ceil(len(name) / 13)


class Dir:
    def __init__(self, cluster_dirents):
        self.cl = cluster_dirents
        self.alloc = cluster_dirents
        self.bits = bytearray(CAP + cluster_dirents)  # 0 = free, 1 = used
        self.bits[0] = self.bits[1] = 1  # "." and ".."
        self.unused = 2
        self.hint = 2

    def create(self, n):
        if self.unused + n <= self.alloc:
            off = self.unused
            self.unused += n
        else:
            run = b"\x00" * n
            off = self.bits.find(run, self.hint, self.alloc)
            if off == -1:
                off = self.bits.find(run, 0, self.alloc)
            if off != -1:
                if off == self.hint:
                    self.hint += n
                if off + n > self.unused:
                    self.unused = off + n
            else:
                if self.alloc >= CAP:
                    return None  # STATUS_CANNOT_MAKE
                off = self.unused
                self.unused += n
                while self.alloc < self.unused:
                    self.alloc += self.cl
        self.bits[off:off + n] = b"\x01" * n
        return off

    def delete(self, off, n):
        self.bits[off:off + n] = b"\x00" * n
        if off + n - 1 < self.hint:
            self.hint = off

    def rename(self, off, old_n, new_n):
        if old_n == new_n:
            return off
        new_off = self.create(new_n)
        if new_off is None:
            return None
        self.delete(off, old_n)
        return new_off

    def used(self):
        return sum(self.bits[: self.alloc])


def replay(names, cluster, scheme):
    d = Dir(cluster)
    for i, name in enumerate(names):
        final_n = dirents(name)
        if scheme == "staging-dir":  # temp lives elsewhere; this directory only ever gets the final name
            if d.create(final_n) is None:
                return i, name, d
            continue
        temp = name + ".xbox-companion-part" if scheme == "part-suffix" else "XC%06d.TMP" % (i % 1000000)
        t = d.create(dirents(temp))
        if t is None:
            return i, name, d
        if d.rename(t, dirents(temp), final_n) is None:
            return i, name, d
    return None, None, d


zpath, inner, cluster_bytes = sys.argv[1], sys.argv[2].rstrip("/") + "/", int(sys.argv[3])
names = sorted(
    i.filename[len(inner):] for i in zipfile.ZipFile(zpath).infolist()
    if i.filename.startswith(inner) and not i.is_dir() and "/" not in i.filename[len(inner):]
)
print(f"{len(names)} files, need {sum(dirents(n) for n in names) + 2} dirents as final names (cap {CAP})")
for scheme in ("part-suffix", "short-temp-same-dir", "staging-dir"):
    idx, name, d = replay(names, cluster_bytes // 32, scheme)
    if idx is None:
        print(f"{scheme:20s} completes: allocation {d.alloc} dirents, used {d.used()}")
    else:
        print(f"{scheme:20s} FAILS at file #{idx + 1} ({idx} committed) {name}: allocation {d.alloc}, used {d.used()}")
