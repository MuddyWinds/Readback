import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AirportSidebar } from "./AirportSidebar";
import { makeResult } from "../../test/renderCard";

afterEach(cleanup);

vi.mock("../../hooks/useWindowWidth", () => ({
  useWindowWidth: () => ({ bp: "large" }),
}));

vi.mock("../../SettingsContext", () => ({
  useSettings: () => ({
    settings: {
      feeds: [{
        airport_code: "KLAX",
        label: "LAX",
        name: "LAX",
        url: "https://audio.liveatc.net/klax",
        lat: 33.9425,
        lon: -118.4081,
        runways: [{ ident: "25L", heading_deg: 251 }],
      }],
    },
    geo: { KLAX: [33.9425, -118.4081] },
  }),
}));

vi.mock("../../lib/queries", () => ({
  useMetar: () => ({
    data: {
      icaoId: "KLAX",
      rawOb: "KLAX METAR",
      wdir: 250,
      wspd: 8,
      wgst: null,
      visib: 10,
      altim: 1013,
      temp: 20,
      dewp: 10,
      fltCat: "VFR",
      wxString: null,
      clouds: [],
    },
    isLoading: false,
    error: null,
  }),
  useNotam: () => ({ data: { notams: [] } }),
  useAdsb: () => ({
    data: {
      aircraft: [{
        icao24: "abc123",
        callsign: "UAL123",
        latitude: 33.95,
        longitude: -118.4,
        altitude_m: 1000,
        on_ground: false,
        velocity_ms: 80,
        heading: 250,
        squawk: "1200",
      }],
    },
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
  }),
}));

vi.mock("./AirportMap", () => ({
  AirportMap: ({ selectedId }: { selectedId?: string | null }) => (
    <div data-testid="airport-map">selected:{selectedId ?? "none"}</div>
  ),
}));

vi.mock("./AircraftList", () => ({
  AircraftList: () => <div data-testid="aircraft-list" />,
}));

vi.mock("./AirportAnalytics", () => ({
  AirportAnalytics: () => <div data-testid="airport-analytics" />,
}));

describe("AirportSidebar selected card context", () => {
  const results = [
    makeResult({
      airport_code: "KLAX",
      enrichment: {
        speaker_segments: [],
        atc_instruction: null,
        pilot_readback: null,
        readback_correct: null,
        readback_discrepancy: null,
        callsign_detected: "UAL123",
        callsign_clarity: 90,
      },
    }),
  ];

  it("passes the matched aircraft to the map", () => {
    render(
      <AirportSidebar
        airportCode="KLAX"
        onClose={vi.fn()}
        results={results}
        selectedAircraft={{ icao24: null, callsign: "UAL123" }}
      />,
    );

    expect(screen.getByTestId("airport-map").textContent).toContain("selected:abc123");
  });

  it("keeps the map info bar concise with ADS-B beside the active runway", () => {
    render(
      <AirportSidebar
        airportCode="KLAX"
        onClose={vi.fn()}
        results={results}
        selectedAircraft={null}
      />,
    );

    expect(screen.queryByText("OSM · scroll/pinch to zoom")).toBeNull();
    const infoLeft = screen.getByTestId("map-info-left").textContent ?? "";
    expect(infoLeft).toContain("ACTIVE RWY 25L");
    expect(infoLeft).toContain("ADS-B Live");
  });

  it("reopens the map section and resets the body scroll when selected context changes", () => {
    const { rerender } = render(
      <AirportSidebar
        airportCode="KLAX"
        onClose={vi.fn()}
        results={results}
        selectedAircraft={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /live traffic map/i }));
    expect(screen.queryByTestId("airport-map")).toBeNull();

    const body = screen.getByTestId("airport-sidebar-body");
    body.scrollTop = 320;

    rerender(
      <AirportSidebar
        airportCode="KLAX"
        onClose={vi.fn()}
        results={results}
        selectedAircraft={{ icao24: null, callsign: "UAL123" }}
      />,
    );

    expect(screen.getByTestId("airport-map")).toBeTruthy();
    expect(body.scrollTop).toBe(0);
  });

  it("resets the body scroll when the same callsign is selected again", () => {
    const { rerender } = render(
      <AirportSidebar
        airportCode="KLAX"
        onClose={vi.fn()}
        results={results}
        selectedAircraft={{ icao24: null, callsign: "UAL123" }}
      />,
    );

    const body = screen.getByTestId("airport-sidebar-body");
    body.scrollTop = 280;

    rerender(
      <AirportSidebar
        airportCode="KLAX"
        onClose={vi.fn()}
        results={results}
        selectedAircraft={{ icao24: null, callsign: "UAL123" }}
      />,
    );

    expect(body.scrollTop).toBe(0);
  });
});
