#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Testes unitários e de integração para a skill organizar-jogos-xbox360-rgh
Verifica o comportamento de detecção de modo (jogo vs biblioteca) e a resolução
do caso ambíguo (biblioteca contendo apenas 1 jogo).
"""

import os
import sys
import shutil
import tempfile
import unittest
import subprocess

# Adiciona o diretório scripts ao sys.path
SCRIPTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "scripts"))
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from organizar_rgh import (
    is_single_game_folder,
    AmbiguousTargetError,
    run_organizer,
)


class TestIsSingleGameFolder(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp(prefix="test_xbox_rgh_")

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_default_xex_in_root_returns_true(self):
        """Pasta contendo default.xex na raiz é inequivocamente um jogo único."""
        xex_file = os.path.join(self.test_dir, "default.xex")
        with open(xex_file, "w") as f:
            f.write("dummy xex")
        self.assertTrue(is_single_game_folder(self.test_dir))

    def test_content_in_root_returns_true(self):
        """Pasta contendo Content na raiz é tratada como jogo único."""
        content_dir = os.path.join(self.test_dir, "Content")
        os.makedirs(content_dir, exist_ok=True)
        self.assertTrue(is_single_game_folder(self.test_dir))

    def test_game_data_in_root_returns_true(self):
        """Pasta contendo arquivo com extensão de dados (.rpf) na raiz é tratada como jogo."""
        rpf_file = os.path.join(self.test_dir, "common.rpf")
        with open(rpf_file, "w") as f:
            f.write("dummy rpf")
        self.assertTrue(is_single_game_folder(self.test_dir))

    def test_two_subdirs_without_game_files_returns_false(self):
        """Biblioteca com 2 ou mais subpastas e sem arquivos de jogo na raiz é biblioteca."""
        os.makedirs(os.path.join(self.test_dir, "Jogo 1"), exist_ok=True)
        os.makedirs(os.path.join(self.test_dir, "Jogo 2"), exist_ok=True)
        self.assertFalse(is_single_game_folder(self.test_dir))

    def test_single_subdir_without_game_files_raises_ambiguous_error(self):
        """Uma única subpasta sem arquivos de jogo na raiz é ambíguo e deve levantar erro."""
        os.makedirs(os.path.join(self.test_dir, "Jogo Unico"), exist_ok=True)
        with self.assertRaises(AmbiguousTargetError):
            is_single_game_folder(self.test_dir)

    def test_single_subdir_with_explicit_mode_biblioteca(self):
        """Com mode='biblioteca', pasta com 1 subpasta é tratada como biblioteca (False)."""
        os.makedirs(os.path.join(self.test_dir, "Jogo Unico"), exist_ok=True)
        self.assertFalse(is_single_game_folder(self.test_dir, mode="biblioteca"))

    def test_single_subdir_with_explicit_mode_jogo(self):
        """Com mode='jogo', pasta com 1 subpasta é tratada como jogo individual (True)."""
        os.makedirs(os.path.join(self.test_dir, "Subpasta Intermediaria"), exist_ok=True)
        self.assertTrue(is_single_game_folder(self.test_dir, mode="jogo"))

    def test_two_subdirs_with_explicit_mode_jogo(self):
        """Com mode='jogo', pasta com 2 subpastas de dados é forçada como jogo único (True)."""
        os.makedirs(os.path.join(self.test_dir, "data"), exist_ok=True)
        os.makedirs(os.path.join(self.test_dir, "media"), exist_ok=True)
        self.assertTrue(is_single_game_folder(self.test_dir, mode="jogo"))

    def test_empty_folder_returns_true(self):
        """Pasta sem subpastas e sem arquivos de jogo devolve True."""
        self.assertTrue(is_single_game_folder(self.test_dir))


class TestCLIIntegration(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp(prefix="test_cli_rgh_")
        self.script_path = os.path.join(SCRIPTS_DIR, "organizar_rgh.py")

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_cli_single_game_in_library_fails_without_flag_and_does_not_touch_files(self):
        """
        Caso do bug: biblioteca com exatamente 1 jogo aninhado.
        Sem flag, o script deve sair com erro (rc != 0), avisar sobre ambiguidade,
        e nenhum arquivo deve ser movido para a raiz da biblioteca.
        """
        bib_dir = os.path.join(self.test_dir, "biblioteca-teste")
        nested_dir = os.path.join(bib_dir, "Jogo Teste", "Sub 1", "Sub 2")
        os.makedirs(nested_dir, exist_ok=True)
        xex_path = os.path.join(nested_dir, "default.xex")
        with open(xex_path, "w") as f:
            f.write("xex content")

        cmd = [sys.executable, self.script_path, "--target", bib_dir]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")

        # Deve falhar com código de saída 1
        self.assertEqual(res.returncode, 1)
        self.assertIn("Alvo ambiguo", res.stdout + res.stderr)
        self.assertIn("--biblioteca", res.stdout + res.stderr)

        # Prova que nenhum arquivo foi movido
        self.assertTrue(os.path.exists(xex_path), "default.xex deve permanecer no local original")
        self.assertFalse(os.path.exists(os.path.join(bib_dir, "default.xex")), "default.xex NÃO pode ir para a raiz da biblioteca")

    def test_cli_single_game_in_library_succeeds_with_biblioteca_flag(self):
        """
        Com --biblioteca, a biblioteca de 1 jogo processa o jogo filho ('[1/1] Jogo Teste'),
        desaninhando o executável para a raiz da pasta do jogo, e não para a raiz da biblioteca.
        """
        bib_dir = os.path.join(self.test_dir, "biblioteca-teste")
        nested_dir = os.path.join(bib_dir, "Jogo Teste", "Sub 1", "Sub 2")
        os.makedirs(nested_dir, exist_ok=True)
        xex_path = os.path.join(nested_dir, "default.xex")
        with open(xex_path, "w") as f:
            f.write("xex content")

        cmd = [sys.executable, self.script_path, "--target", bib_dir, "--biblioteca"]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")

        self.assertEqual(res.returncode, 0, f"Falha na execução: {res.stdout}\n{res.stderr}")
        self.assertIn("[1/1] Jogo Teste", res.stdout)

        # O executável foi desaninhado para a pasta do jogo
        game_xex = os.path.join(bib_dir, "Jogo Teste", "default.xex")
        self.assertTrue(os.path.exists(game_xex), "default.xex deve estar em <biblioteca>/Jogo Teste/default.xex")
        self.assertFalse(os.path.exists(os.path.join(bib_dir, "default.xex")), "default.xex NUNCA deve estar na raiz da biblioteca")

    def test_cli_two_games_in_library_works_automatically(self):
        """
        Biblioteca com 2 jogos funciona automaticamente sem precisar de flags.
        """
        bib_dir = os.path.join(self.test_dir, "biblioteca-dois-jogos")
        g1_dir = os.path.join(bib_dir, "Jogo A", "Sub")
        g2_dir = os.path.join(bib_dir, "Jogo B", "Sub")
        os.makedirs(g1_dir, exist_ok=True)
        os.makedirs(g2_dir, exist_ok=True)
        with open(os.path.join(g1_dir, "default.xex"), "w") as f:
            f.write("game A")
        with open(os.path.join(g2_dir, "default.xex"), "w") as f:
            f.write("game B")

        cmd = [sys.executable, self.script_path, "--target", bib_dir]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")

        self.assertEqual(res.returncode, 0)
        self.assertIn("Total de pastas de jogos a processar: 2", res.stdout)
        self.assertIn("[1/2] Jogo A", res.stdout)
        self.assertIn("[2/2] Jogo B", res.stdout)
        self.assertTrue(os.path.exists(os.path.join(bib_dir, "Jogo A", "default.xex")))
        self.assertTrue(os.path.exists(os.path.join(bib_dir, "Jogo B", "default.xex")))

    def test_cli_nested_single_game_succeeds_with_jogo_flag(self):
        """
        Jogo aninhado em subpasta única processado com --jogo é desaninhado para sua própria raiz.
        """
        game_dir = os.path.join(self.test_dir, "Meu Jogo")
        nested_dir = os.path.join(game_dir, "Sub 1", "Sub 2")
        os.makedirs(nested_dir, exist_ok=True)
        with open(os.path.join(nested_dir, "default.xex"), "w") as f:
            f.write("game content")

        cmd = [sys.executable, self.script_path, "--target", game_dir, "--jogo"]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")

        self.assertEqual(res.returncode, 0)
        self.assertIn("[1/1] Meu Jogo", res.stdout)
        self.assertTrue(os.path.exists(os.path.join(game_dir, "default.xex")))

    def test_cli_mutually_exclusive_flags_rejected(self):
        """Passar --jogo e --biblioteca simultaneamente é rejeitado pelo parser."""
        cmd = [sys.executable, self.script_path, "--target", self.test_dir, "--jogo", "--biblioteca"]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")
        self.assertNotEqual(res.returncode, 0)
        self.assertIn("not allowed with argument", res.stderr + res.stdout)


if __name__ == "__main__":
    unittest.main()

