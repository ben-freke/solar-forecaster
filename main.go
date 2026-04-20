package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Response represents the forecast.solar API response
type Response struct {
	Result  Result  `json:"result"`
	Message Message `json:"message"`
}

type Result struct {
	Watts           map[string]float64 `json:"watts"`
	WattHoursPeriod map[string]float64 `json:"watt_hours_period"`
	WattHours       map[string]float64 `json:"watt_hours"`
	WattHoursDay    map[string]float64 `json:"watt_hours_day"`
}

type Message struct {
	Code      int       `json:"code"`
	Type      string    `json:"type"`
	Text      string    `json:"text"`
	RateLimit RateLimit `json:"ratelimit"`
}

type RateLimit struct {
	Limit     int `json:"limit"`
	Remaining int `json:"remaining"`
}

func main() {
	lat := flag.Float64("lat", 0, "Latitude in decimal degrees (required)")
	lon := flag.Float64("lon", 0, "Longitude in decimal degrees (required)")
	dec := flag.Float64("dec", 0, "Panel declination/tilt angle in degrees 0-90 (required)")
	az := flag.Float64("az", 0, "Azimuth: 0=South, -90=East, 90=West, 180=North (required)")
	kwp := flag.Float64("kwp", 0, "Peak power of the solar array in kWp (required)")
	horizonFile := flag.String("horizon", "", "Path to horizon file (values in degrees, clockwise from North)")
	apiKey := flag.String("apikey", "", "API key for higher rate limits and resolution")
	limit := flag.Int("limit", 2, "Number of days to forecast (1-8)")
	resolution := flag.Int("resolution", 60, "Data resolution in minutes (15, 30, or 60)")
	damping := flag.String("damping", "", "Damping factor applied to both morning and evening (0-1), or comma-separated 'morning,evening'")
	dampingMorning := flag.String("damping-morning", "", "Damping factor for morning only (0-1); overrides -damping if set")
	dampingEvening := flag.String("damping-evening", "", "Damping factor for evening only (0-1); overrides -damping if set")
	inverter := flag.Float64("inverter", 0, "Maximum inverter output power in kW (0=unlimited)")

	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage: solar-forecaster [options]\n\nFetches solar production forecasts from forecast.solar.\n\nOptions:\n")
		flag.PrintDefaults()
		fmt.Fprintf(os.Stderr, `
Horizon file format:
  A text file with comma-separated degree values (0-90) representing the
  height of obstructions (buildings, trees) at each compass bearing,
  progressing clockwise from North. At least 12 values recommended.

  Example (12 values at 30-degree intervals starting from North):
    0,0,15,30,45,60,60,60,45,30,15,0

  One value per line is also accepted.

Examples:
  solar-forecaster -lat 51.5 -lon -0.1 -dec 35 -az 0 -kwp 5.0
  solar-forecaster -lat 51.5 -lon -0.1 -dec 35 -az 0 -kwp 5.0 -horizon horizon.txt
  solar-forecaster -lat 51.5 -lon -0.1 -dec 35 -az 0 -kwp 5.0 -apikey YOUR_KEY -resolution 30 -limit 4
  solar-forecaster -lat 51.5 -lon -0.1 -dec 35 -az 0 -kwp 5.0 -damping 0.5
  solar-forecaster -lat 51.5 -lon -0.1 -dec 35 -az 0 -kwp 5.0 -damping 0.25,0.75
  solar-forecaster -lat 51.5 -lon -0.1 -dec 35 -az 0 -kwp 5.0 -damping-morning 0.3 -damping-evening 0.6
`)
	}

	flag.Parse()

	if *lat == 0 && *lon == 0 {
		fmt.Fprintln(os.Stderr, "error: -lat and -lon are required")
		flag.Usage()
		os.Exit(1)
	}
	if *kwp <= 0 {
		fmt.Fprintln(os.Stderr, "error: -kwp must be greater than 0")
		flag.Usage()
		os.Exit(1)
	}
	if *limit < 1 || *limit > 8 {
		fmt.Fprintln(os.Stderr, "error: -limit must be between 1 and 8")
		os.Exit(1)
	}
	if *resolution != 15 && *resolution != 30 && *resolution != 60 {
		fmt.Fprintln(os.Stderr, "error: -resolution must be 15, 30, or 60")
		os.Exit(1)
	}

	// Build endpoint URL
	var endpoint string
	if *apiKey != "" {
		endpoint = fmt.Sprintf("https://api.forecast.solar/%s/estimate/%g/%g/%g/%g/%g",
			*apiKey, *lat, *lon, *dec, *az, *kwp)
	} else {
		endpoint = fmt.Sprintf("https://api.forecast.solar/estimate/%g/%g/%g/%g/%g",
			*lat, *lon, *dec, *az, *kwp)
	}

	params := url.Values{}
	params.Set("time", "iso8601")
	if *limit != 2 {
		params.Set("limit", strconv.Itoa(*limit))
	}
	if *resolution != 60 {
		params.Set("resolution", strconv.Itoa(*resolution))
	}
	if *dampingMorning != "" || *dampingEvening != "" {
		// Separate morning/evening — these take precedence over -damping
		if *dampingMorning != "" {
			if err := validateDamping(*dampingMorning); err != nil {
				fmt.Fprintf(os.Stderr, "error: -damping-morning: %v\n", err)
				os.Exit(1)
			}
			params.Set("damping_morning", *dampingMorning)
		}
		if *dampingEvening != "" {
			if err := validateDamping(*dampingEvening); err != nil {
				fmt.Fprintf(os.Stderr, "error: -damping-evening: %v\n", err)
				os.Exit(1)
			}
			params.Set("damping_evening", *dampingEvening)
		}
	} else if *damping != "" {
		// Combined: single value or "morning,evening"
		parts := strings.SplitN(*damping, ",", 2)
		for _, p := range parts {
			if err := validateDamping(strings.TrimSpace(p)); err != nil {
				fmt.Fprintf(os.Stderr, "error: -damping: %v\n", err)
				os.Exit(1)
			}
		}
		params.Set("damping", *damping)
	}
	if *inverter > 0 {
		params.Set("inverter", strconv.FormatFloat(*inverter, 'f', -1, 64))
	}

	if *horizonFile != "" {
		horizon, err := loadHorizon(*horizonFile)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error loading horizon file: %v\n", err)
			os.Exit(1)
		}
		params.Set("horizon", horizon)
		fmt.Printf("Using horizon: %s\n\n", horizon)
	}

	requestURL := endpoint + "?" + params.Encode()

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(requestURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error fetching forecast: %v\n", err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	var forecast Response
	if err := json.NewDecoder(resp.Body).Decode(&forecast); err != nil {
		fmt.Fprintf(os.Stderr, "error parsing response: %v\n", err)
		os.Exit(1)
	}

	if resp.StatusCode != http.StatusOK {
		fmt.Fprintf(os.Stderr, "API error %d: %s\n", resp.StatusCode, forecast.Message.Text)
		os.Exit(1)
	}

	printForecast(forecast, *kwp)
}

func validateDamping(s string) error {
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return fmt.Errorf("invalid value %q: not a number", s)
	}
	if v < 0 || v > 1 {
		return fmt.Errorf("value %g out of range: must be 0-1", v)
	}
	return nil
}

func loadHorizon(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}

	// Normalize: treat newlines as commas, split and clean
	content := strings.ReplaceAll(string(data), "\r\n", ",")
	content = strings.ReplaceAll(content, "\n", ",")
	content = strings.ReplaceAll(content, "\r", ",")

	parts := strings.Split(content, ",")
	var values []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		v, err := strconv.ParseFloat(p, 64)
		if err != nil {
			return "", fmt.Errorf("invalid value %q: not a number", p)
		}
		if v < 0 || v > 90 {
			return "", fmt.Errorf("invalid horizon value %g: must be 0-90 degrees", v)
		}
		values = append(values, p)
	}

	if len(values) < 4 {
		return "", fmt.Errorf("need at least 4 values, got %d", len(values))
	}

	return strings.Join(values, ","), nil
}

func printForecast(f Response, kwp float64) {
	fmt.Printf("Solar Production Forecast\n")
	fmt.Printf("=========================\n\n")

	if f.Message.Type != "" && f.Message.Type != "success" {
		fmt.Printf("Warning: %s\n\n", f.Message.Text)
	}

	// Daily totals
	if len(f.Result.WattHoursDay) > 0 {
		fmt.Printf("Daily Totals:\n")
		days := sortedKeys(f.Result.WattHoursDay)
		for _, day := range days {
			wh := f.Result.WattHoursDay[day]
			psh := (wh / 1000) / kwp // peak sun hours = kWh / kWp
			fmt.Printf("  %s  %7.0f Wh  (%5.2f kWh,  %.2f peak sun hours)\n",
				day, wh, wh/1000, psh)
		}
		fmt.Println()
	}

	// Hourly power
	if len(f.Result.Watts) > 0 {
		fmt.Printf("Power Output (Watts):\n")

		timestamps := sortedKeys(f.Result.Watts)
		peakW := findPeak(f.Result.Watts)

		var currentDay string
		for _, ts := range timestamps {
			w := f.Result.Watts[ts]

			t, err := time.Parse(time.RFC3339, ts)
			if err != nil {
				// Try without timezone offset
				t, err = time.Parse("2006-01-02T15:04:05+00:00", ts)
				if err != nil {
					t, _ = time.Parse("2006-01-02T15:04:05", ts)
				}
			}

			day := t.Format("Mon 2006-01-02")
			if day != currentDay {
				currentDay = day
				fmt.Printf("\n  %s:\n", day)
			}

			bar := powerBar(w, peakW, 24)
			fmt.Printf("    %s  %6.0f W  %s\n", t.Format("15:04"), w, bar)
		}
		fmt.Println()
	}

	// Rate limit info
	if f.Message.RateLimit.Limit > 0 {
		fmt.Printf("Rate limit: %d/%d remaining (rolling 60-minute window)\n",
			f.Message.RateLimit.Remaining, f.Message.RateLimit.Limit)
	}
}

func sortedKeys(m map[string]float64) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func findPeak(m map[string]float64) float64 {
	var peak float64
	for _, v := range m {
		if v > peak {
			peak = v
		}
	}
	if peak == 0 {
		return 1
	}
	return peak
}

func powerBar(watts, peakWatts float64, width int) string {
	if watts <= 0 {
		return strings.Repeat("░", width)
	}
	filled := int(watts / peakWatts * float64(width))
	if filled > width {
		filled = width
	}
	return strings.Repeat("█", filled) + strings.Repeat("░", width-filled)
}