"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import { toTitleCase } from "@/lib/toTitleCase";
import type { RegionConfig, ZonalRow } from "@/lib/types";

/**
 * "All" sentinel. Empty string is safe: no province / municipality /
 * classification value is ever empty in the option lists (blanks are dropped),
 * so "" can only mean "no filter on this level".
 */
export const ALL = "";

export interface FilterState {
  province: string;
  municipality: string;
  classification: string;
  text: string;
}

interface Props {
  regions: ReadonlyArray<RegionConfig>;
  regionId: string;
  /** Rows for the currently loaded region, or [] while loading / errored. */
  rows: ReadonlyArray<ZonalRow>;
  /** True while the selected region is fetching. */
  loading: boolean;
  /** True once the region's rows are in hand. */
  ready: boolean;
  filters: FilterState;
  onRegionChange: (id: string) => void;
  onProvinceChange: (value: string) => void;
  onMunicipalityChange: (value: string) => void;
  onClassificationChange: (value: string) => void;
  onTextChange: (value: string) => void;
  onSubmit: () => void;
  onReset: () => void;
}

/** Distinct, non-empty values, sorted by their display form. */
function distinct(values: Iterable<string>, display: (v: string) => string): Array<string> {
  const set = new Set<string>();
  for (const v of values) {
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => display(a).localeCompare(display(b)));
}

/**
 * One labelled dropdown.
 *
 * When there are 0 or 1 real options the control collapses to a disabled
 * select showing the single value (or "All"). This is generic — it is what
 * quietly handles Region XII's lone province without special-casing the region
 * by name. A dropdown with one choice is noise; a disabled one that states the
 * fixed value is honest.
 */
function FilterSelect({
  id,
  label,
  value,
  values,
  display,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  values: Array<string>;
  display: (v: string) => string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const collapsed = values.length <= 1;

  if (collapsed) {
    const only = values[0];
    return (
      <div className="field">
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
        <select id={id} className="field-select" disabled value={only ? "one" : "all"}>
          <option value={only ? "one" : "all"}>{only ? display(only) : "All"}</option>
        </select>
      </div>
    );
  }

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="field-select"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value={ALL}>All</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {display(v)}
          </option>
        ))}
      </select>
    </div>
  );
}

const asis = (v: string): string => v;

export function FilterPanel({
  regions,
  regionId,
  rows,
  loading,
  ready,
  filters,
  onRegionChange,
  onProvinceChange,
  onMunicipalityChange,
  onClassificationChange,
  onTextChange,
  onSubmit,
  onReset,
}: Props): ReactNode {
  const { province, municipality, classification, text } = filters;

  // Options are DERIVED from the loaded rows, narrowed by the levels above.
  // They are a pure function of state — recomputing them costs nothing and,
  // crucially, never touches the frozen results set.
  const provinceValues = useMemo(
    () => distinct(rows.map((r) => r.province), toTitleCase),
    [rows],
  );

  const municipalityValues = useMemo(() => {
    const scoped = province === ALL ? rows : rows.filter((r) => r.province === province);
    return distinct(scoped.map((r) => r.municipality), asis);
  }, [rows, province]);

  const classificationValues = useMemo(() => {
    let scoped = rows;
    if (province !== ALL) scoped = scoped.filter((r) => r.province === province);
    if (municipality !== ALL) scoped = scoped.filter((r) => r.municipality === municipality);
    return distinct(scoped.map((r) => r.classification), asis);
  }, [rows, province, municipality]);

  return (
    <form
      className="filter-panel"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="field">
        <label className="field-label" htmlFor="region">
          Region
        </label>
        <select
          id="region"
          className="field-select"
          value={regionId}
          disabled={loading}
          onChange={(event) => onRegionChange(event.target.value)}
        >
          {regions.map((region) => (
            <option key={region.id} value={region.id}>
              {region.label}
            </option>
          ))}
        </select>
      </div>

      <FilterSelect
        id="province"
        label="Province"
        value={province}
        values={provinceValues}
        display={toTitleCase}
        disabled={!ready}
        onChange={onProvinceChange}
      />

      <FilterSelect
        id="municipality"
        label="Municipality / City"
        value={municipality}
        values={municipalityValues}
        display={asis}
        disabled={!ready}
        onChange={onMunicipalityChange}
      />

      <FilterSelect
        id="classification"
        label="Classification"
        value={classification}
        values={classificationValues}
        display={asis}
        disabled={!ready}
        onChange={onClassificationChange}
      />

      <div className="field">
        <label className="field-label" htmlFor="query">
          Text search
        </label>
        <input
          id="query"
          className="field-input"
          type="text"
          autoComplete="off"
          placeholder="butuan, CR, commercial…"
          value={text}
          disabled={!ready}
          onChange={(event) => onTextChange(event.target.value)}
        />
        <p className="field-hint">
          Matches municipality, province, RDO, code, or classification. Leave blank to browse by
          the dropdowns alone.
        </p>
      </div>

      <div className="filter-actions">
        <button type="button" className="btn btn-ghost" disabled={loading} onClick={onReset}>
          Reset
        </button>
        <button type="submit" className="btn btn-primary" disabled={!ready}>
          Run Zonal
        </button>
      </div>
    </form>
  );
}
