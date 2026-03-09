"""Unit tests for drive_downloader.py."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from drive_downloader import (
    build_direct_download_url,
    download_file,
    download_file_authenticated,
    download_submission_files,
    extract_file_id,
    get_gnome_oauth_token,
    get_mission_stem,
    search_drive_by_name,
)
from models import SubmissionPayload


class TestExtractFileId:
    """Test Google Drive URL parsing."""

    def test_standard_share_url(self):
        url = "https://drive.google.com/file/d/1aBcDeFgHiJkLmN/view?usp=sharing"
        assert extract_file_id(url) == "1aBcDeFgHiJkLmN"

    def test_open_url(self):
        url = "https://drive.google.com/open?id=1aBcDeFgHiJkLmN"
        assert extract_file_id(url) == "1aBcDeFgHiJkLmN"

    def test_id_param_url(self):
        url = "https://drive.google.com/uc?export=download&id=1aBcDeFgHiJkLmN"
        assert extract_file_id(url) == "1aBcDeFgHiJkLmN"

    def test_bare_file_id(self):
        assert extract_file_id("1aBcDeFgHiJkLmNoPqRsTuVwXyZ") == "1aBcDeFgHiJkLmNoPqRsTuVwXyZ"

    def test_invalid_url(self):
        assert extract_file_id("https://example.com/nothing") is None

    def test_empty_string(self):
        assert extract_file_id("") is None


class TestBuildDownloadUrl:
    def test_correct_format(self):
        url = build_direct_download_url("abc123")
        assert url == "https://drive.google.com/uc?export=download&id=abc123"


class TestGetMissionStem:
    def test_waypoints_extension(self):
        assert get_mission_stem("HQ-DEMO-180m.waypoints") == "HQ-DEMO-180m"

    def test_no_extension(self):
        assert get_mission_stem("mission") == "mission"


class TestGetGnomeOauthToken:
    """Test GNOME OAuth token retrieval."""

    def test_successful_token(self):
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "('ya29.faketoken123', 1519)\n"

        with patch("drive_downloader.subprocess.run", return_value=mock_result) as mock_run:
            token = get_gnome_oauth_token("/org/gnome/OnlineAccounts/Accounts/test")
            assert token == "ya29.faketoken123"
            mock_run.assert_called_once()

    def test_gdbus_failure(self):
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stderr = "No such object"

        with patch("drive_downloader.subprocess.run", return_value=mock_result):
            token = get_gnome_oauth_token("/org/gnome/OnlineAccounts/Accounts/bad")
            assert token is None

    def test_subprocess_exception(self):
        with patch("drive_downloader.subprocess.run", side_effect=Exception("no gdbus")):
            token = get_gnome_oauth_token("/some/path")
            assert token is None


class TestSearchDriveByName:
    """Test Drive API search."""

    @pytest.mark.asyncio
    async def test_file_found(self):
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "files": [{"id": "abc123", "name": "test.waypoints"}]
        }
        mock_response.raise_for_status = MagicMock()

        with patch("drive_downloader.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = await search_drive_by_name("test.waypoints", "fake-token")
            assert result == "abc123"

    @pytest.mark.asyncio
    async def test_file_not_found(self):
        mock_response = MagicMock()
        mock_response.json.return_value = {"files": []}
        mock_response.raise_for_status = MagicMock()

        with patch("drive_downloader.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = await search_drive_by_name("nonexistent.waypoints", "fake-token")
            assert result is None


class TestDownloadFile:
    """Test file download with mocked HTTP."""

    @pytest.mark.asyncio
    async def test_successful_download(self, tmp_path: Path):
        async def fake_aiter():
            yield b"fake file data"

        mock_response = MagicMock()
        mock_response.content = b"fake file data"
        mock_response.raise_for_status = MagicMock()
        mock_response.aiter_bytes = fake_aiter

        with patch("drive_downloader.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            dest = tmp_path / "test.waypoints"
            result = await download_file(
                "https://drive.google.com/file/d/abc123/view", dest
            )
            assert result == dest
            assert dest.read_bytes() == b"fake file data"

    @pytest.mark.asyncio
    async def test_invalid_drive_link(self, tmp_path: Path):
        with pytest.raises(ValueError, match="Could not extract file ID"):
            await download_file("https://example.com/nothing", tmp_path / "out.bin")


class TestDownloadSubmissionFiles:
    """Test full submission file download."""

    @pytest.mark.asyncio
    async def test_authenticated_download_by_name(self, test_repo_path: Path, sample_payload: SubmissionPayload):
        """Test that authenticated download searches by filename first."""
        with patch("drive_downloader.get_gnome_oauth_token", return_value="fake-token"), \
             patch("drive_downloader.search_drive_by_name", new_callable=AsyncMock, return_value="found-id"), \
             patch("drive_downloader.download_file_authenticated", new_callable=AsyncMock) as mock_auth_dl:

            mock_auth_dl.return_value = Path("/fake/path")

            result = await download_submission_files(sample_payload, test_repo_path)

            assert result.success
            # Should have called search_drive_by_name with the mission filename
            # and download_file_authenticated with the found ID (+ images)
            assert mock_auth_dl.call_count >= 1
            first_call = mock_auth_dl.call_args_list[0]
            assert first_call[0][0] == "found-id"  # file_id
            assert "HQ-DEMO-180m.waypoints" in str(first_call[0][1])  # dest_path

    @pytest.mark.asyncio
    async def test_fallback_to_unauthenticated(self, test_repo_path: Path, sample_payload: SubmissionPayload):
        """Test fallback when GNOME token is unavailable."""
        with patch("drive_downloader.get_gnome_oauth_token", return_value=None), \
             patch("drive_downloader.download_file", new_callable=AsyncMock) as mock_dl:

            mock_dl.return_value = Path("/fake/path")

            result = await download_submission_files(sample_payload, test_repo_path)

            assert result.success
            # Should have called unauthenticated download_file
            mock_dl.assert_called()

    @pytest.mark.asyncio
    async def test_auth_fails_then_fallback(self, test_repo_path: Path, sample_payload: SubmissionPayload):
        """Test that when auth download fails, it falls back to unauthenticated."""
        with patch("drive_downloader.get_gnome_oauth_token", return_value="fake-token"), \
             patch("drive_downloader.search_drive_by_name", new_callable=AsyncMock, side_effect=Exception("API error")), \
             patch("drive_downloader.download_file", new_callable=AsyncMock) as mock_dl:

            mock_dl.return_value = Path("/fake/path")

            result = await download_submission_files(sample_payload, test_repo_path)

            assert result.success
            mock_dl.assert_called()

    @pytest.mark.asyncio
    async def test_all_methods_fail(self, test_repo_path: Path, sample_payload: SubmissionPayload):
        """Test when both auth and unauth downloads fail."""
        with patch("drive_downloader.get_gnome_oauth_token", return_value=None), \
             patch("drive_downloader.download_file", new_callable=AsyncMock, side_effect=Exception("Network error")):

            result = await download_submission_files(sample_payload, test_repo_path)

            assert not result.success
            assert "Network error" in result.error
