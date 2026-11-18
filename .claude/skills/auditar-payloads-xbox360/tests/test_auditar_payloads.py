import io
import json
import os
import sys
import tempfile
import unittest
import zipfile

SCRIPTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "scripts"))
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

import auditar_payloads as ap  # noqa: E402


class TestClassifyZipEntries(unittest.TestCase):
    def test_valid_xex_game(self):
        entries = [
            {"name": "FIFA 19 PT-BR/default.xex", "size": 12_000_000},
            {"name": "FIFA 19 PT-BR/data/big.big", "size": 4_000_000_000},
        ]
        res = ap.classify_zip_entries("FIFA 19 PT-BR", entries)
        self.assertEqual(res["status"], "OK_XEX")
        self.assertFalse(res["is_broken"])

    def test_valid_god_game(self):
        entries = [
            {"name": "Content/0000000000000000/45410998/00007000/ABC123", "size": 45_000},
            {"name": "Content/0000000000000000/45410998/00007000/ABC123.data/Data0000", "size": 170_000_000},
        ]
        res = ap.classify_zip_entries("FIFA 14 GOD", entries)
        self.assertEqual(res["status"], "OK_GOD")
        self.assertFalse(res["is_broken"])
        self.assertEqual(res["god_title_ids"], ["45410998"])

    def test_nested_decoy_rar_broken(self):
        entries = [
            {"name": "sdfasdasdfas.rar", "size": 5_347_000_000},
        ]
        res = ap.classify_zip_entries("FIFA 23_24 ATT.SETEMBRO ( XBOX 360 RGH )", entries)
        self.assertEqual(res["status"], "BROKEN_NESTED_ARCHIVE")
        self.assertTrue(res["is_broken"])

    def test_save_only_broken(self):
        entries = [
            {"name": "Content/E00039D75217C032/454109EE/00000001/Squads2024", "size": 7_600_000},
            {"name": "Leia-me.txt", "size": 512},
        ]
        res = ap.classify_zip_entries("FIFA 19 + ATUALIZAÇÃO ELENCO 2023_2024", entries)
        self.assertEqual(res["status"], "BROKEN_SAVE_ONLY")
        self.assertTrue(res["is_broken"])

    def test_patch_and_trainers_without_base_game_broken(self):
        entries = [
            {"name": "Content/0000000000000000/4A3007D3/00000001/ONFIRE00.cpk", "size": 1_500_000_000},
            {"name": "Content/0000000000000000/4A3007D3/00000001/DpFileList.bin", "size": 2048},
            {"name": "[Aurora]Trainer Collection/Trainer.xex", "size": 120_000},
            {"name": "[Aurora]Trainer Collection/XYZPatcher.xex", "size": 90_000},
        ]
        res = ap.classify_zip_entries("PES 2026 - THE JOKER PATCH SETEMBRO 2025", entries)
        self.assertEqual(res["status"], "BROKEN_PATCH_ONLY")
        self.assertTrue(res["is_broken"])

    def test_xell_elf_homebrew_broken(self):
        entries = [
            {"name": "mupen64-360/xenon.elf", "size": 2_000_000},
            {"name": "mupen64-360/roms/mario.z64", "size": 8_000_000},
        ]
        res = ap.classify_zip_entries("Emulador Nintendo N64 MUPEN", entries)
        self.assertEqual(res["status"], "BROKEN_HOMEBREW_ELF")
        self.assertTrue(res["is_broken"])

    def test_title_mismatch_sleeping_dogs_in_gta5(self):
        entries = [
            {"name": "SLEEPING DOGS PT-BR/default.xex", "size": 15_000_000},
        ]
        res = ap.classify_zip_entries("GTA 5 PT-BR + DLC + TU", entries)
        self.assertEqual(res["status"], "BROKEN_TITLE_MISMATCH")
        self.assertTrue(res["is_broken"])

    def test_playable_game_with_extra_unexpected_game_warns(self):
        entries = [
            {"name": "PES BRAZUKAS 2025/default.xex", "size": 15_000_000},
            {"name": "SLEEPING DOGS PT-BR/default.xex", "size": 14_000_000},
        ]
        res = ap.classify_zip_entries("BRAZUKAS PES2025 ( XBOX 360 RGH )", entries)
        self.assertEqual(res["status"], "OK_XEX_WITH_WARNINGS")
        self.assertFalse(res["is_broken"])
        self.assertTrue(any("SLEEPING DOGS" in w for w in res["warnings"]))


class TestHelpers(unittest.TestCase):
    def test_parse_known_bad_go_and_zip_reader(self):
        with tempfile.TemporaryDirectory() as tmp:
            go_file = os.path.join(tmp, "huggingface.go")
            with open(go_file, "w", encoding="utf-8") as f:
                f.write(
                    'package cache\nvar knownBadHuggingFaceFiles = map[string]bool{\n'
                    '\t"gta 5 (7.61).7z": true,\n'
                    '\t"bomba patch 2025 ( xbox 360 rgh ).zip": true,\n'
                    '}\n'
                )
            parsed = ap.parse_known_bad_go(go_file)
            self.assertEqual(parsed, {"gta 5 (7.61).7z", "bomba patch 2025 ( xbox 360 rgh ).zip"})

            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w") as zf:
                zf.writestr("Game/default.xex", b"XEX2")
            raw = buf.getvalue()
            with zipfile.ZipFile(io.BytesIO(raw)) as zf:
                entries = [{"name": i.filename, "size": i.file_size} for i in zf.infolist()]
            self.assertEqual(ap.classify_zip_entries("Game", entries)["status"], "OK_XEX")

    def test_http_401_is_auth_required_not_broken(self):
        import urllib.error
        from unittest import mock

        err = urllib.error.HTTPError("https://archive.org/download/x/y.rar", 401, "Unauthorized", {}, None)
        with mock.patch.object(ap, "RangeHTTPFile", side_effect=err):
            res = ap.audit_remote_item({"title": "FIFA 08", "url": "https://archive.org/download/x/y.rar"})
        self.assertEqual(res["status"], "AUTH_REQUIRED_HTTP_401")
        self.assertFalse(res["is_broken"])
        self.assertEqual(res["http_status"], 401)


if __name__ == "__main__":
    unittest.main()
