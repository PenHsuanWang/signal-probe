# Software Requirements Specification

**Product:** signal-probe
**Feature:** User-Configurable X-Axis Datetime Column & Signal Unit Mapping
**Version:** 1.0
**Date:** 2026-04-23
**Status:** Draft

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Epics & User Stories](#2-epics--user-stories)
   - [EPIC-1: Enhanced Column Configuration at Upload Time](#epic-1-enhanced-column-configuration-at-upload-time)
     - [USER STORY-1.1: Datetime Column Selection for X-Axis (Stacked Format)](#user-story-11-datetime-column-selection-for-x-axis-stacked-format)
     - [USER STORY-1.2: Optional Unit Column Mapping](#user-story-12-optional-unit-column-mapping)
3. [Non-Functional Requirements](#3-non-functional-requirements)
4. [Out-of-Scope](#4-out-of-scope)
5. [Glossary & Definitions](#5-glossary--definitions)

---

## 1. Product Overview

- **Product Name:** signal-probe
- **Business Goal:** signal-probe is a multi-channel time-series analysis tool that allows users to upload CSV or Parquet signal files, configure column mappings, and visualise processed signals in an interactive multi-panel chart. This feature set increases data configurability during the upload configuration step so that analysts can:
  - (a) Explicitly choose which temporal column drives the shared x-axis for stacked-format CSVs, removing reliance on hardcoded column-name aliases.
  - (b) Optionally map a *unit column* from the uploaded CSV so that each channel's y-axis label shows the correct physical measurement unit (e.g., "mV", "°C", "rpm").
- **Target Audience:** Data engineers and signal-quality analysts who upload multi-channel time-series CSV files, including files produced by third-party measurement equipment that uses non-standard column names or includes a unit column alongside the signal data.

---

## 2. Epics & User Stories

### EPIC-1: Enhanced Column Configuration at Upload Time

**Description:** Extend the `AWAITING_CONFIG` step of the existing two-step upload flow so that users have explicit control over (1) which datetime column anchors the x-axis and (2) whether a unit column should be mapped to per-channel y-axis labels. Both features augment the existing `POST /signals/{id}/process` endpoint without breaking the current wide-format workflow.

**Affected upload flow:**

```
POST /signals/upload           →  Signal created; status = AWAITING_CONFIG
GET  /signals/{id}/raw-columns →  Frontend reads column descriptors + CSV format
POST /signals/{id}/process     →  User submits column config; pipeline is queued
GET  /signals/{id}/macro       →  Frontend renders processed macro-view chart
```

---

#### USER STORY-1.1: Datetime Column Selection for X-Axis (Stacked Format)

- **User Story:** As an analyst uploading a stacked/long-format CSV, I want to explicitly select which temporal column is used as the x-axis, so that I can work with vendor-specific datetime columns without relying on the hardcoded "datetime" alias.

- **Background / Current Limitation:** The pipeline auto-detects the datetime column for stacked format by normalising column names to lower-case and resolving a fixed alias table (`format_constants.STACKED_COL_ALIASES`). If a CSV has multiple temporal columns, or if the datetime column name is not in the alias table, the pipeline silently uses the wrong column or fails. Wide format already provides an explicit `TimeColumnSelector` radio-group in `ColumnConfigPanel.tsx`; stacked format needs equivalent explicit control.

- **Acceptance Criteria (BDD Format):**

  - **Scenario 1 — Happy Path: explicit selection overrides alias detection**
    - **Given** a stacked-format CSV containing columns `event_time` (temporal dtype), `signal_name`, `signal_value`
    - **When** the user opens the column config panel, selects `event_time` as the datetime column, and clicks "Process Signal"
    - **Then** the pipeline computes elapsed seconds from `event_time`
    - **And** `t0_epoch_s` is set to the Unix epoch of the first `event_time` value
    - **And** the macro chart x-axis displays correct absolute date/time labels derived from `event_time`

  - **Scenario 2 — Single temporal column: auto-selected, still visible**
    - **Given** a stacked-format CSV with exactly one temporal column (e.g., `datetime`)
    - **When** the column config panel loads
    - **Then** that column is pre-selected as the datetime column without requiring user action
    - **And** the selector is still rendered so the user can verify the selection

  - **Scenario 3 — Multiple temporal columns: user must choose**
    - **Given** a stacked-format CSV with two temporal columns (`start_time` and `end_time`)
    - **When** the column config panel loads
    - **Then** the first temporal column is pre-selected (preferring the canonical `datetime` name if present)
    - **And** the user can switch the selection by clicking a different radio option
    - **And** the Process Signal button becomes active once a selection is confirmed

  - **Scenario 4 — No temporal column detected**
    - **Given** a stacked-format CSV with no column of `temporal` dtype
    - **When** the column config panel renders
    - **Then** an inline warning "No datetime column detected — processing may fail" is displayed
    - **And** the Process Signal button remains disabled

  - **Scenario 5 — Datetime column collides with a signal channel (validation guard)**
    - **Given** the user somehow selects a column as both the datetime column and a signal channel
    - **When** the form state is validated before submission
    - **Then** an inline error "Datetime column cannot also be a signal channel" is shown
    - **And** the form is not submitted

- **Business Rules:**
  - Only columns with `temporal` dtype (as returned by `GET /signals/{id}/raw-columns`) may be selected as the datetime column.
  - The `datetime_column` field in `ProcessSignalRequest` is **optional at the API level** for backward compatibility: if omitted, the backend falls back to alias-based detection (`STACKED_COL_ALIASES`). The frontend always sends the value.
  - For stacked format, the selected `datetime_column` bypasses the alias normalisation step and is used directly by the pipeline reader.
  - The pre-selection default for stacked format follows this priority: canonical `datetime` → first `temporal`-dtype column in file order.

- **UI/UX Notes:**
  - Reuse the existing `TimeColumnSelector` sub-component inside `ColumnConfigPanel.tsx`. Render it above the existing `StackedChannelPicker` block.
  - Relabel the section heading "Datetime axis column" (compared to "Time axis column" used for wide format) to make the distinction clear.
  - Display a "suggested" badge on any column whose name matches a known alias from `STACKED_COL_ALIASES` (e.g., `datetime`, `measurement_datetime`).
  - Filter the radio-group to show **only** `temporal`-dtype columns.

---

#### USER STORY-1.2: Optional Unit Column Mapping

- **User Story:** As an analyst uploading a CSV that contains a unit column (e.g., a stacked CSV with a `unit` column associating each signal with its measurement unit), I want to optionally map that column during configuration so that each channel's y-axis label shows the correct physical unit (e.g., "mV", "°C", "rpm") in the chart.

- **Background / Current Limitation:** The pipeline currently drops all columns that are neither the time axis nor a signal value channel, including any `unit` columns. No unit information is persisted to the processed Parquet or surfaced in `MacroViewResponse`. In `MultiChannelMacroChart.tsx`, all channel y-axes always display a blank title (`title: { text: '' }`).

- **Acceptance Criteria (BDD Format):**

  - **Scenario 1 — Stacked CSV: user selects unit column, per-channel units displayed**
    - **Given** a stacked-format CSV with columns `datetime`, `signal_name`, `signal_value`, `unit`
    - **And** the `unit` column contains `"mV"` for all rows of `signal_1` and `"°C"` for all rows of `signal_2`
    - **When** the user selects the `unit` column in the column config panel and submits
    - **Then** after processing, the macro chart y-axis panel for `signal_1` shows `"mV"` as its axis title
    - **And** the y-axis panel for `signal_2` shows `"°C"`

  - **Scenario 2 — User skips unit column (optional field)**
    - **Given** any CSV upload (stacked or wide format)
    - **When** the user leaves the unit column selector at its default "(none)" option
    - **Then** processing proceeds exactly as before with no unit labels and no errors
    - **And** no existing behaviour is changed

  - **Scenario 3 — Wide CSV: single shared unit value**
    - **Given** a wide-format CSV where one string column contains a constant unit value (e.g., `"rpm"`) across all rows
    - **When** the user selects that column as the unit column
    - **Then** the backend reads the most common non-null value from that column
    - **And** all selected signal channels display `"rpm"` on their y-axes

  - **Scenario 4 — Partial unit data: graceful degradation**
    - **Given** the selected unit column has null or empty values for one or more `signal_name` values
    - **When** processing completes
    - **Then** channels with a resolved non-null unit show the unit string on their y-axis
    - **And** channels with null or empty units show no y-axis label (blank string)
    - **And** no error is raised

  - **Scenario 5 — Unit column overlaps with a signal channel**
    - **Given** the user attempts to select a column that is already selected as a signal channel as the unit column
    - **When** the form validates on submit
    - **Then** an inline error "Unit column cannot be a signal channel" is shown
    - **And** the form is not submitted

  - **Scenario 6 — Unit column overlaps with the datetime/time column**
    - **Given** the user attempts to select the datetime or time column as the unit column
    - **When** the form validates on submit
    - **Then** an inline error "Unit column cannot be the datetime column" is shown
    - **And** the form is not submitted

  - **Scenario 7 — Unit string exceeds 32 characters**
    - **Given** the unit column contains values longer than 32 characters
    - **When** processing stores and returns the channel units
    - **Then** those values are silently truncated to 32 characters with a trailing `"…"` character
    - **And** no error is raised

- **Business Rules:**
  - Unit column selection is **optional**; omitting it leaves all existing behaviour unchanged.
  - Only columns with `string` dtype (as returned by `GET /signals/{id}/raw-columns`) may be selected as the unit column.
  - The unit column must differ from the time/datetime column and must not appear in the selected signal channel list.
  - Unit strings are capped at **32 characters** (including the trailing `"…"`) for safe display.
  - **Stacked format derivation rule:** the unit for a given channel equals the **first non-null** value of the unit column in the rows where `signal_name` matches that channel, after alias normalisation and null-drop.
  - **Wide format derivation rule:** the unit per channel equals the **most common non-null** value in the unit column across all rows (a single shared unit). Each signal channel receives the same value.
  - The resolved `channel_units` map `{channel_name: unit_string}` is stored as a constant column (`channel_unit_<name>`) in the processed Parquet file so it can be reconstructed at read time, and is returned as part of `MacroViewResponse`.

- **UI/UX Notes:**
  - Add a clearly secondary "Unit column (optional)" section to `ColumnConfigPanel.tsx`, placed below the signal/channel selectors in both wide and stacked format panels.
  - The selector is a radio-group listing only `string`-dtype columns, with `"(none)"` as the first and default option.
  - For stacked format, after the user selects a valid unit column, show an inline preview table mapping `signal_name → unit` (up to five rows; if there are more, append "…and N more channels").
  - The preview is rendered from the raw `stacked_signal_names` list and the sampled column values already available on the frontend (no extra API call required).

---

## 3. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Performance** | Reading and extracting unit values from the unit column must add ≤ 50 ms to pipeline processing time for files up to 100 000 rows, measured on a single-core baseline. |
| **Backward Compatibility** | All existing processed signals (without `channel_units` metadata) continue to display exactly as before. `MacroViewResponse.channel_units` defaults to an empty map `{}` when the field is absent from the Parquet. No existing API request or response fields are renamed or removed. |
| **API Versioning** | New request fields (`datetime_column`, `unit_column`) are additive and optional. Existing clients that do not send these fields continue to work without modification. The API version prefix (`/api/v1`) is unchanged. |
| **Validation** | The backend validates all user-supplied column names (`datetime_column`, `unit_column`) against the actual file headers before the pipeline is queued, returning HTTP 422 with a descriptive message on failure. |
| **Usability** | Unit column selection must be clearly labelled as optional so users are not confused about whether it is required. The datetime-column selector for stacked format must pre-select a sensible default to avoid disrupting the existing stacked-format workflow for users who do not change the default. |
| **Accessibility** | New UI sections must follow the same accessibility patterns already in use: `role="group"` / `role="radiogroup"`, `aria-labelledby`, and keyboard-navigable inputs. |
| **Data Integrity** | If the selected `datetime_column` or `unit_column` is not found in the file at pipeline execution time (e.g., file was corrupted), the pipeline transitions the signal to `FAILED` status and stores a descriptive `error_message`. |

---

## 4. Out-of-Scope

The following related ideas were considered but are **explicitly out of scope** for this feature:

| Item | Reason |
|---|---|
| Allowing the user to specify the **time unit multiplier** for numeric time columns (e.g., "this column is in milliseconds") | Separate feature; not requested. |
| Storing unit information in the database `signal_metadata` table | Unit data is stored only in the Parquet file and surfaced via the macro API response. |
| Supporting per-row variable units (where unit changes row-by-row for the same channel) | Ambiguous display; only the first non-null unit per channel is used. |
| Editing or overriding units after processing | Would require re-processing or a separate metadata patch endpoint; deferred. |
| Exposing `channel_units` in the `RunChunkResponse` | Callers can read units from `MacroViewResponse` once and cache them; not duplicated in chunk responses. |

---

## 5. Glossary & Definitions

| Term | Definition |
|---|---|
| **Wide format** | A CSV where each signal channel occupies its own column and one column (temporal or numeric) serves as the shared time axis. Example: `timestamp, sensor_a, sensor_b`. |
| **Stacked / long format** | A CSV with three canonical columns — `datetime`, `signal_name`, `signal_value` — where all channels share the same rows, differentiated by the `signal_name` value. |
| **AWAITING_CONFIG** | The initial processing status of a newly uploaded signal that has not yet been configured by the user. |
| **t0_epoch_s** | The Unix epoch timestamp (in seconds, float) of the first data point. Used by the frontend to reconstruct absolute `Date`/time labels on the x-axis: `new Date((t0_epoch_s + elapsed_s) * 1000)`. |
| **datetime_column** | The name of the temporal column in a stacked CSV that the pipeline will use to build the elapsed-seconds x-axis. |
| **unit_column** | An optional column in the CSV whose string values describe the physical measurement unit of each signal channel (e.g., `"mV"`, `"°C"`, `"rpm"`). |
| **channel_units** | A JSON map `{channel_name → unit_string}` derived from the `unit_column` during pipeline processing and returned in `MacroViewResponse` for y-axis labelling. |
| **STACKED_COL_ALIASES** | A dict in `app/domain/signal/format_constants.py` that maps non-standard stacked-format column names to their canonical equivalents (e.g., `"measurement_datetime"` → `"datetime"`). |
| **ColumnDescriptor** | A Pydantic value object returned by `GET /signals/{id}/raw-columns` that describes a single column: `name`, `dtype` (`temporal` / `numeric` / `string` / `boolean`), `sample_values`, `null_count`, and `is_candidate_time`. |
| **MacroViewResponse** | The API response from `GET /signals/{id}/macro` containing the shared x-axis values, per-channel y-data and states, run bounds, `t0_epoch_s`, and (after this feature) `channel_units`. |
