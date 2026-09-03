from __future__ import annotations

"""Unit tests for HuggingFaceExporter.push_to_hub and CustomTokenizer.push_to_hub."""

import os
import sys
import types
import unittest
from typing import Any
from unittest.mock import MagicMock, patch

from uniqtoken.hf_exporter import HuggingFaceExporter
from uniqtoken.tokenizer import CustomTokenizer

# Ensure `patch("huggingface_hub.HfApi")` works even when the optional
# dependency is not installed (the zero-dependency rule). If the real
# package exists this is a no-op.
try:
    import huggingface_hub  # noqa: F401
except ImportError:  # pragma: no cover - env without optional dep
    _stub = types.ModuleType("huggingface_hub")
    _stub.HfApi = MagicMock  # type: ignore[attr-defined]
    sys.modules["huggingface_hub"] = _stub


def _build_tiny_tokenizer() -> CustomTokenizer:
    corpus = [
        "the quick brown fox jumps over the lazy dog",
        "fast parallel batch encoding verification",
        "neural language model subword regularization",
    ]
    return CustomTokenizer.train_from_corpus(
        corpus, target_vocab_size=320, hex_literals=False, digit_chunking="greedy", verbose=False
    )


class PushToHubTests(unittest.TestCase):
    def test_push_to_hub_calls_create_repo_and_upload_folder(self) -> None:
        tokenizer = _build_tiny_tokenizer()
        captured: dict[str, Any] = {}

        def _upload_folder_side_effect(**kwargs: Any) -> str:
            captured["kwargs"] = kwargs
            folder = kwargs["folder_path"]
            # Files must already be staged while the temp dir is alive.
            captured["staged_files"] = sorted(os.listdir(folder))
            with open(os.path.join(folder, "README.md"), encoding="utf-8") as f:
                captured["readme"] = f.read()
            return "https://huggingface.co/test-user/test-repo/commit/abc123"

        with patch("huggingface_hub.HfApi") as mock_hf_api:
            mock_api = MagicMock()
            mock_api.upload_folder.side_effect = _upload_folder_side_effect
            mock_hf_api.return_value = mock_api

            HuggingFaceExporter.push_to_hub(tokenizer, "test-user/test-repo", token="hf_test_token")

            # HfApi instantiated with the provided token.
            mock_hf_api.assert_called_once_with(token="hf_test_token")
            # Repo is created idempotently; visibility is set at creation time.
            mock_api.create_repo.assert_called_once_with(repo_id="test-user/test-repo", exist_ok=True, private=False)
            # Folder upload uses defaults for commit message and staging dir contents.
            mock_api.upload_folder.assert_called_once()
            _, upload_kwargs = mock_api.upload_folder.call_args
            self.assertEqual(upload_kwargs["repo_id"], "test-user/test-repo")
            self.assertEqual(upload_kwargs["commit_message"], "Upload UniqToken model")
            self.assertNotIn("private", upload_kwargs)
            self.assertIsInstance(upload_kwargs["folder_path"], str)
            self.assertTrue(len(upload_kwargs["folder_path"]) > 0)

        self.assertIn("tokenizer.json", captured["staged_files"])
        self.assertIn("tokenizer_config.json", captured["staged_files"])
        self.assertIn("README.md", captured["staged_files"])
        self.assertIn("test-user/test-repo", captured["readme"])

    def test_push_to_hub_forwards_commit_message_and_kwargs(self) -> None:
        tokenizer = _build_tiny_tokenizer()
        with patch("huggingface_hub.HfApi") as mock_hf_api:
            mock_api = MagicMock()
            mock_hf_api.return_value = mock_api

            HuggingFaceExporter.push_to_hub(
                tokenizer,
                "org/model",
                token=None,
                commit_message="Custom message",
                private=True,
            )

            mock_hf_api.assert_called_once_with(token=None)
            # `private` is routed to create_repo; upload_folder accepts no such argument.
            mock_api.create_repo.assert_called_once_with(repo_id="org/model", exist_ok=True, private=True)
            _, upload_kwargs = mock_api.upload_folder.call_args
            self.assertEqual(upload_kwargs["repo_id"], "org/model")
            self.assertEqual(upload_kwargs["commit_message"], "Custom message")
            self.assertNotIn("private", upload_kwargs)

    def test_push_to_hub_missing_dependency_raises_helpful_import_error(self) -> None:
        tokenizer = _build_tiny_tokenizer()
        with patch.dict(sys.modules, {"huggingface_hub": None}):
            with self.assertRaises(ImportError) as ctx:
                HuggingFaceExporter.push_to_hub(tokenizer, "test-user/test-repo")
        self.assertIn("pip install huggingface_hub", str(ctx.exception))

    def test_custom_tokenizer_push_to_hub_delegates_to_exporter(self) -> None:
        tokenizer = _build_tiny_tokenizer()
        with patch.object(HuggingFaceExporter, "push_to_hub") as mock_push:
            tokenizer.push_to_hub("test-user/test-repo", token="hf_tok", commit_message="msg", private=True)
            mock_push.assert_called_once_with(
                tokenizer, "test-user/test-repo", token="hf_tok", commit_message="msg", private=True
            )


if __name__ == "__main__":
    unittest.main()
