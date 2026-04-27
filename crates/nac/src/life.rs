//! Conway's Game of Life implementation for TUI background animation.
//!
//! This module provides a cellular automaton simulation using Braille patterns
//! for rendering. It includes various seed patterns (gliders, spaceships, etc.)
//! and automatic pattern injection when activity becomes low.

use rand::rngs::StdRng;
use rand::RngExt;
use rand::SeedableRng;
use ratatui::text::{Line, Span};

/// Generate a deterministic seed from prompt and dimensions
pub fn hash_seed(prompt: &str, width: usize, height: usize, version: &str) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(version.as_bytes());
    hasher.update(prompt.as_bytes());
    hasher.update(&width.to_le_bytes());
    hasher.update(&height.to_le_bytes());
    hasher.finalize().into()
}

/// Configuration for the Life simulation injector.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LifeConfig {
    /// Heat decay factor (0.95-0.995). Higher = longer memory of activity.
    pub heat_decay: f32,
    /// Zone width for analysis (8, 16, 24)
    pub zone_width: usize,
    /// Zone height for analysis (8, 16, 24)
    pub zone_height: usize,
    /// How often to check for injection (8, 16, 32, 64 generations)
    pub check_interval: u64,
    /// Target global activity ratio (0.01-0.08 = 1-8%)
    pub target_activity: f32,
    /// Gain for converting activity deficit to injection chance (10-30)
    pub injection_gain: f32,
    /// Maximum injection probability per check (0.05-0.25)
    pub max_injection_chance: f32,
    /// Minimum zone cooldown after injection (generations)
    pub zone_cooldown_min: u32,
    /// Maximum zone cooldown after injection (generations)
    pub zone_cooldown_max: u32,
    /// Chance of pattern mutation (0.02-0.08)
    pub mutation_chance: f32,
    /// Initial soup density (0.015-0.06 = 1.5-6%)
    pub initial_soup_density: f32,
    /// How often to check for pruning (generations)
    pub prune_interval: u64,
    /// Zone density threshold that triggers pruning (0.0-1.0)
    pub prune_density_threshold: f32,
    /// Percentage of cells to remove from dense zones (0.0-1.0)
    pub prune_percentage: f32,
    /// How much to favor center zones (0.0 = no bias, 1.0 = strong center bias)
    pub center_bias: f32,
    /// How often to rebalance cell distribution (generations)
    pub rebalance_interval: u64,
}

impl Default for LifeConfig {
    fn default() -> Self {
        Self {
            heat_decay: 0.98,
            zone_width: 8,  // Was 16 - smaller zones for better variance measurement
            zone_height: 8, // Was 16
            check_interval: 64,
            target_activity: 0.005, // Was 0.008 - even lower (0.5%)
            injection_gain: 5.0,
            max_injection_chance: 0.05,
            zone_cooldown_min: 800,
            zone_cooldown_max: 4000,
            mutation_chance: 0.05,
            initial_soup_density: 0.01,    // Was 0.015 - 1% initial
            prune_interval: 30,            // Moderate pruning frequency
            prune_density_threshold: 0.25, // Prune zones above 25% density
            prune_percentage: 0.45,        // Remove 45% from dense zones
            center_bias: 0.3,              // Moderate center bias to counteract edge effects
            rebalance_interval: 100,       // Rebalance every 100 generations
        }
    }
}

/// Statistics for a single zone in the life field.
#[derive(Debug, Clone, Copy, Default)]
pub struct ZoneStats {
    /// Heat value representing recent activity (decays over time).
    pub heat: f32,
    /// Current cell density in this zone (0.0-1.0).
    pub density: f32,
    /// Cooldown counter preventing immediate re-injection.
    pub cooldown: u32,
    /// Count of cells that changed this generation.
    pub changed_count: usize,
    /// Generation when this zone was last injected (0 = never).
    pub last_injection_generation: u64,
}

impl ZoneStats {
    /// Records a cell change in this zone.
    pub fn record_change(&mut self) {
        self.changed_count += 1;
    }

    /// Decays the heat value by the given factor.
    pub fn decay_heat(&mut self, decay: f32) {
        self.heat *= decay;
    }

    /// Updates the density value.
    pub fn update_density(&mut self, alive: usize, total: usize) {
        self.density = if total == 0 {
            0.0
        } else {
            alive as f32 / total as f32
        };
    }

    /// Returns true if the zone is cool (no cooldown active).
    pub fn is_cool(&self) -> bool {
        self.cooldown == 0
    }

    /// Decrements cooldown if active.
    pub fn tick_cooldown(&mut self) {
        if self.cooldown > 0 {
            self.cooldown -= 1;
        }
    }

    /// Sets cooldown to a random value between min and max.
    pub fn set_cooldown(&mut self, min: u32, max: u32, rng: &mut impl rand::Rng) {
        self.cooldown = rng.random_range(min..=max);
    }

    /// Resets the changed count for a new generation.
    pub fn reset_changed(&mut self) {
        self.changed_count = 0;
    }

    /// Adds heat to the zone (e.g., from activity).
    pub fn add_heat(&mut self, amount: f32) {
        self.heat = (self.heat + amount).min(1.0);
    }
    /// Check if zone is on cooldown
    pub fn is_on_cooldown(&self) -> bool {
        self.cooldown > 0
    }

    /// Check if zone is cold (low heat) and empty (very low density)
    pub fn is_cold_empty(&self) -> bool {
        self.heat < 0.1 && self.density < 0.05
    }

    /// Check if zone is cold (low heat) and has ash/debris (moderate density)
    pub fn is_cold_ash(&self) -> bool {
        self.heat < 0.1 && self.density >= 0.05 && self.density < 0.5
    }
}

/// A predefined seed pattern for the Game of Life.
#[derive(Clone, Copy, Debug)]
pub struct SeedPattern {
    /// Width of the pattern in cells.
    pub width: usize,
    /// Height of the pattern in cells.
    pub height: usize,
    /// Coordinates of live cells within the pattern bounds.
    pub cells: &'static [(usize, usize)],
}

/// Placement configuration for injecting a pattern into the life field.
#[derive(Clone, Copy, Debug)]
pub struct PatternPlacement {
    /// The pattern to place.
    pub pattern: SeedPattern,
    /// Horizontal offset from center (scaled by LIFE_LAYOUT_WIDTH_SCALE).
    pub dx: isize,
    /// Vertical offset from center.
    pub dy: isize,
    /// Rotation in 90-degree increments (0-3).
    pub rotation: u8,
    /// Whether to flip horizontally after rotation.
    pub flip: bool,
}

/// The glider pattern - a small spaceship that moves diagonally.
pub const GLIDER_PATTERN: SeedPattern = SeedPattern {
    width: 3,
    height: 3,
    cells: &[(1, 0), (2, 1), (0, 2), (1, 2), (2, 2)],
};

/// The R-pentomino pattern - a small methuselah that evolves for many generations.
pub const R_PENTOMINO_PATTERN: SeedPattern = SeedPattern {
    width: 3,
    height: 3,
    cells: &[(1, 0), (2, 0), (0, 1), (1, 1), (1, 2)],
};

/// The acorn pattern - a methuselah that evolves for 5206 generations.
pub const ACORN_PATTERN: SeedPattern = SeedPattern {
    width: 7,
    height: 3,
    cells: &[(1, 0), (3, 1), (0, 2), (1, 2), (4, 2), (5, 2), (6, 2)],
};

/// The lightweight spaceship (LWSS) pattern - moves orthogonally.
pub const LWSS_PATTERN: SeedPattern = SeedPattern {
    width: 5,
    height: 4,
    cells: &[
        (1, 0),
        (2, 0),
        (3, 0),
        (4, 0),
        (0, 1),
        (4, 1),
        (4, 2),
        (0, 3),
        (3, 3),
    ],
};

/// Small random blob pattern (4x4) for variety
pub const RANDOM_BLOB_4X4: SeedPattern = SeedPattern {
    width: 4,
    height: 4,
    cells: &[
        (1, 0),
        (2, 0),
        (0, 1),
        (3, 1),
        (1, 2),
        (2, 2),
        (0, 3),
        (3, 3),
    ],
};

/// Medium random blob pattern (5x5) for variety
pub const RANDOM_BLOB_5X5: SeedPattern = SeedPattern {
    width: 5,
    height: 5,
    cells: &[
        (1, 0),
        (3, 0),
        (0, 1),
        (2, 1),
        (4, 1),
        (1, 2),
        (3, 2),
        (0, 3),
        (2, 3),
        (4, 3),
        (1, 4),
        (3, 4),
    ],
};

/// Large random blob pattern (6x6) for variety
pub const RANDOM_BLOB_6X6: SeedPattern = SeedPattern {
    width: 6,
    height: 6,
    cells: &[
        (1, 0),
        (4, 0),
        (0, 1),
        (2, 1),
        (3, 1),
        (5, 1),
        (1, 2),
        (4, 2),
        (1, 3),
        (4, 3),
        (0, 4),
        (2, 4),
        (3, 4),
        (5, 4),
        (1, 5),
        (4, 5),
    ],
};

/// The Game of Life field state.
#[derive(Debug)]
pub struct LifeField {
    /// Width of the field in cells.
    width: usize,
    /// Height of the field in cells.
    height: usize,
    /// Cell states - true for alive, false for dead.
    cells: Vec<bool>,
    /// Counter for consecutive ticks with low activity.
    low_activity_ticks: usize,
    /// Current phase for pattern injection rotation.
    injection_phase: usize,
    /// Configuration for the simulation.
    config: LifeConfig,
    /// Random number generator for probabilistic decisions.
    rng: StdRng,
    /// Heatmap tracking activity per cell.
    heatmap: Vec<f32>,
    /// Zone statistics for regional analysis.
    zones: Vec<ZoneStats>,
    /// Current generation counter.
    generation: u64,
    /// List of cells that changed in the last step.
    last_changed_cells: Vec<(usize, usize)>,
}

impl Default for LifeField {
    fn default() -> Self {
        Self {
            width: 0,
            height: 0,
            cells: Vec::new(),
            low_activity_ticks: 0,
            injection_phase: 0,
            config: LifeConfig::default(),
            rng: StdRng::from_rng(&mut rand::rng()),
            heatmap: Vec::new(),
            zones: Vec::new(),
            generation: 0,
            last_changed_cells: Vec::new(),
        }
    }
}

impl LifeField {
    /// Create a new LifeField seeded from a prompt
    pub fn from_seed(prompt: &str, width: usize, height: usize) -> Self {
        let seed = hash_seed(prompt, width, height, "life-generator-v1");
        let mut field = Self {
            width,
            height,
            cells: vec![false; width * height],
            low_activity_ticks: 0,
            injection_phase: 0,
            config: LifeConfig::default(),
            rng: StdRng::from_seed(seed),
            heatmap: vec![0.0; width * height],
            zones: Vec::new(),
            generation: 0,
            last_changed_cells: Vec::new(),
        };
        field.initialize_zones();
        field.seed_from_rng();
        field
    }

    fn initialize_zones(&mut self) {
        // Calculate number of zones based on config
        let zone_cols = (self.width + self.config.zone_width - 1) / self.config.zone_width;
        let zone_rows = (self.height + self.config.zone_height - 1) / self.config.zone_height;
        self.zones = vec![ZoneStats::default(); zone_cols * zone_rows];
    }

    fn seed_from_rng(&mut self) {
        use rand::prelude::IndexedRandom;

        let width = self.width;
        let height = self.height;

        // 1. Create sparse random soup (1.5-6% density)
        let density = self.config.initial_soup_density;
        for y in 0..height {
            for x in 0..width {
                if self.rng.random::<f32>() < density {
                    let idx = y * width + x;
                    if idx < self.cells.len() {
                        self.cells[idx] = true;
                    }
                }
            }
        }

        // 2. Place several methuselahs at random positions
        let methuselahs = [&R_PENTOMINO_PATTERN, &ACORN_PATTERN];
        let num_methuselahs = self.rng.random_range(2..=5);
        for _ in 0..num_methuselahs {
            let pattern = methuselahs.choose(&mut self.rng).unwrap();
            let x = self.rng.random_range(0..width);
            let y = self.rng.random_range(0..height);
            let rotation = self.rng.random_range(0..4);
            let flip = self.rng.random_bool(0.5);

            let placement = PatternPlacement {
                pattern: **pattern,
                dx: x as isize,
                dy: y as isize,
                rotation,
                flip,
            };
            self.place_pattern(pattern, &placement);
        }

        // 3. Add moving patterns (gliders, LWSS) in balanced pairs to cancel drift
        // Place patterns in mirrored pairs: (x, y) and (width-x, height-y) with opposite rotations
        // This ensures left/right and up/down movement cancel out
        let moving = [&GLIDER_PATTERN, &LWSS_PATTERN];
        let num_pairs = self.rng.random_range(2..=4); // 2-4 pairs = 4-8 total patterns

        for _ in 0..num_pairs {
            let pattern = moving.choose(&mut self.rng).unwrap();

            // Random position for first pattern
            let x1 = self.rng.random_range(0..width);
            let y1 = self.rng.random_range(0..height);
            // Random rotation for first pattern
            let rot1 = self.rng.random_range(0..4);
            let flip1 = self.rng.random_bool(0.5);

            // Mirrored position for second pattern (opposite side of torus)
            let x2 = (width - x1) % width;
            let y2 = (height - y1) % height;
            // Opposite rotation to cancel movement direction
            // rot2 = (rot1 + 2) % 4 gives opposite direction for both gliders and LWSS
            let rot2 = (rot1 + 2) % 4;
            let flip2 = flip1; // Same flip to maintain symmetry

            // Place first pattern
            let placement1 = PatternPlacement {
                pattern: **pattern,
                dx: x1 as isize,
                dy: y1 as isize,
                rotation: rot1,
                flip: flip1,
            };
            self.place_pattern(pattern, &placement1);

            // Place mirrored pattern with opposite rotation
            let placement2 = PatternPlacement {
                pattern: **pattern,
                dx: x2 as isize,
                dy: y2 as isize,
                rotation: rot2,
                flip: flip2,
            };
            self.place_pattern(pattern, &placement2);
        }

        // 4. Add a few small random blobs (4x4 to 6x6)
        let num_blobs = self.rng.random_range(2..=4);
        for _ in 0..num_blobs {
            self.place_random_blob();
        }
    }

    /// Place a small random blob pattern
    fn place_random_blob(&mut self) {
        let blob_size = self.rng.random_range(4..=6);
        let x = self
            .rng
            .random_range(0..self.width.saturating_sub(blob_size));
        let y = self
            .rng
            .random_range(0..self.height.saturating_sub(blob_size));

        // Random blob with ~50% density
        for dy in 0..blob_size {
            for dx in 0..blob_size {
                if self.rng.random_bool(0.5) {
                    let px = x + dx;
                    let py = y + dy;
                    if px < self.width && py < self.height {
                        let idx = py * self.width + px;
                        if idx < self.cells.len() {
                            self.cells[idx] = true;
                        }
                    }
                }
            }
        }
    }

    /// Ensures the field has the specified dimensions, reseeding if changed.
    ///
    /// # Arguments
    /// * `width` - Desired width in cells
    /// * `height` - Desired height in cells
    pub fn ensure_size(&mut self, width: usize, height: usize) {
        let width = width.max(2);
        let height = height.max(4);
        if self.width == width && self.height == height && !self.cells.is_empty() {
            return;
        }

        self.width = width;
        self.height = height;
        self.cells = vec![false; width * height];
        self.heatmap = vec![0.0; width * height];
        self.low_activity_ticks = 0;
        self.injection_phase = 0;
        self.generation = 0;
        self.last_changed_cells.clear();

        // Re-initialize zones and seed with RNG
        self.initialize_zones();
        self.seed_from_rng();
    }

    /// Advances the simulation by one generation using Conway's rules.
    ///
    /// Rules:
    /// - Live cell with 2-3 neighbors survives
    /// - Dead cell with 3 or 6 neighbors becomes alive (highlife variant for 6)
    /// - All other cells die or stay dead
    ///
    /// The new heatmap-based injection system monitors activity across zones
    /// and injects patterns when activity falls below target levels.
    pub fn step(&mut self) {
        if self.width == 0 || self.height == 0 || self.cells.is_empty() {
            return;
        }

        // Store old state for heatmap comparison
        let old_cells = self.cells.clone();

        // Clear last changed cells tracking
        self.last_changed_cells.clear();

        // Perform Game of Life simulation (existing logic)
        let width = self.width;
        let height = self.height;
        let mut next = vec![false; width * height];

        for y in 0..height {
            for x in 0..width {
                let idx = y * width + x;
                let alive = self.cells[idx];
                let neighbors = self.live_neighbor_count(x, y);

                let next_alive = match (alive, neighbors) {
                    (true, 2) | (true, 3) => true,
                    (true, 6) => true, // High life variation
                    (false, 3) => true,
                    _ => false,
                };

                next[idx] = next_alive;
                if alive != next_alive {
                    self.last_changed_cells.push((x, y));
                }
            }
        }

        self.cells = next;
        self.generation += 1;

        // Update heatmap with changes
        self.update_heatmap(&old_cells);

        // Update zone statistics
        self.update_zones();

        // Decay cooldowns
        self.decay_cooldowns();

        // Maybe inject new patterns
        self.maybe_inject();

        // Periodically rebalance cell distribution
        self.rebalance();

        // Prune dense areas periodically
        if self.generation % self.config.prune_interval == 0 {
            self.prune_dense_areas();
        }
    }

    /// Renders the field as a vector of ratatui Lines using Braille characters.
    ///
    /// Each Braille character represents a 2x4 block of cells, allowing for
    /// compact display of the life field.
    ///
    /// # Arguments
    /// * `char_width` - Width in characters (each char is 2 cells wide)
    /// * `char_height` - Height in characters (each char is 4 cells tall)
    ///
    /// # Returns
    /// Vector of Lines representing the rendered field
    pub fn render_lines(&self, char_width: usize, char_height: usize) -> Vec<Line<'static>> {
        let mut lines = Vec::with_capacity(char_height);
        for char_y in 0..char_height {
            let mut text = String::with_capacity(char_width);
            for char_x in 0..char_width {
                let dot_x = char_x * 2;
                let dot_y = char_y * 4;
                text.push(self.braille_char(dot_x, dot_y));
            }
            lines.push(Line::from(Span::raw(text)));
        }
        lines
    }

    /// Generates a Braille character representing a 2x4 cell block.
    ///
    /// Braille dots are mapped to cell positions:
    /// - Dots 1-4 map to left column (top to bottom)
    /// - Dots 5-8 map to right column (top to bottom)
    ///
    /// # Arguments
    /// * `dot_x` - X coordinate of the left cell in the block
    /// * `dot_y` - Y coordinate of the top cell in the block
    ///
    /// # Returns
    /// A Braille Unicode character (U+2800 to U+28FF)
    pub fn braille_char(&self, dot_x: usize, dot_y: usize) -> char {
        let mut bits = 0u32;
        for local_y in 0..4 {
            for local_x in 0..2 {
                let x = dot_x + local_x;
                let y = dot_y + local_y;
                if x < self.width && y < self.height && self.cells[self.index(x, y)] {
                    bits |= match (local_x, local_y) {
                        (0, 0) => 0x01,
                        (0, 1) => 0x02,
                        (0, 2) => 0x04,
                        (0, 3) => 0x40,
                        (1, 0) => 0x08,
                        (1, 1) => 0x10,
                        (1, 2) => 0x20,
                        (1, 3) => 0x80,
                        _ => 0,
                    };
                }
            }
        }
        char::from_u32(0x2800 + bits).unwrap_or(' ')
    }

    /// Counts the number of live neighbors for a cell.
    ///
    /// Uses toroidal wrapping - edges connect to the opposite side.
    ///
    /// # Arguments
    /// * `x` - X coordinate of the cell
    /// * `y` - Y coordinate of the cell
    ///
    /// # Returns
    /// Count of live neighbors (0-8)
    pub fn live_neighbor_count(&self, x: usize, y: usize) -> u8 {
        let mut count = 0u8;
        for dy in [-1isize, 0, 1] {
            for dx in [-1isize, 0, 1] {
                if dx == 0 && dy == 0 {
                    continue;
                }
                let nx = wrap_index(x, dx, self.width);
                let ny = wrap_index(y, dy, self.height);
                if self.cells[self.index(nx, ny)] {
                    count += 1;
                }
            }
        }
        count
    }

    /// Converts 2D coordinates to a 1D array index.
    ///
    /// # Arguments
    /// * `x` - X coordinate
    /// * `y` - Y coordinate
    ///
    /// # Returns
    /// Index into the cells vector
    pub fn index(&self, x: usize, y: usize) -> usize {
        y * self.width + x
    }

    /// Update heatmap after a generation step
    /// heat = heat * decay + (changed ? 1.0 : 0.0)
    pub fn update_heatmap(&mut self, old_cells: &[bool]) {
        let decay = self.config.heat_decay;
        for y in 0..self.height {
            for x in 0..self.width {
                let idx = self.index(x, y);
                let changed = old_cells[idx] != self.cells[idx];
                let current_heat = self.heatmap[idx];
                self.heatmap[idx] = current_heat * decay + if changed { 1.0 } else { 0.0 };
            }
        }
    }

    /// Update zone statistics based on current state
    pub fn update_zones(&mut self) {
        let zone_cols = (self.width + self.config.zone_width - 1) / self.config.zone_width;
        let zone_rows = (self.height + self.config.zone_height - 1) / self.config.zone_height;

        for zy in 0..zone_rows {
            for zx in 0..zone_cols {
                let zone_idx = zy * zone_cols + zx;
                let zone = &mut self.zones[zone_idx];

                // Calculate zone bounds
                let x_start = zx * self.config.zone_width;
                let y_start = zy * self.config.zone_height;
                let x_end = (x_start + self.config.zone_width).min(self.width);
                let y_end = (y_start + self.config.zone_height).min(self.height);

                // Sum heat and count live cells
                let mut total_heat = 0.0;
                let mut live_cells = 0;
                let mut changed_cells = 0;
                let zone_area = (x_end - x_start) * (y_end - y_start);

                for y in y_start..y_end {
                    for x in x_start..x_end {
                        let idx = y * self.width + x; // Compute index directly
                        total_heat += self.heatmap[idx];
                        if self.cells[idx] {
                            live_cells += 1;
                        }
                        // Track changes from last step
                        if self.last_changed_cells.contains(&(x, y)) {
                            changed_cells += 1;
                        }
                    }
                }

                zone.heat = (total_heat / zone_area as f32).min(5.0); // Cap at 5.0 for better normalization
                zone.density = live_cells as f32 / zone_area as f32;
                zone.changed_count = changed_cells;
            }
        }
    }

    /// Decrement all zone cooldowns by 1
    pub fn decay_cooldowns(&mut self) {
        for zone in &mut self.zones {
            if zone.cooldown > 0 {
                zone.cooldown -= 1;
            }
        }
    }

    /// Choose a zone for injection using weighted randomness
    /// Prefers cold zones near warm zones
    pub fn choose_injection_zone(&mut self) -> Option<usize> {
        let zone_cols = (self.width + self.config.zone_width - 1) / self.config.zone_width;
        let zone_rows = (self.height + self.config.zone_height - 1) / self.config.zone_height;

        let mut weights: Vec<(usize, f32)> = Vec::new();

        for zy in 0..zone_rows {
            for zx in 0..zone_cols {
                let zone_idx = zy * zone_cols + zx;
                let zone = &self.zones[zone_idx];

                // Skip zones on cooldown
                if zone.is_on_cooldown() {
                    continue;
                }

                // Calculate coldness (1.0 = coldest, 0.0 = hottest)
                // Heat is capped at 5.0, so normalize to [0, 1]
                let coldness = 1.0 - (zone.heat / 5.0).min(1.0);

                // Calculate neighbor heat (prefer cold zones near warm zones)
                let neighbor_heat = self.get_neighbor_zone_heat(zx, zy, zone_cols, zone_rows);

                // Density suitability (avoid too empty or too dense)
                let density_suitability = if zone.density < 0.05 {
                    0.3 // Too empty, less suitable
                } else if zone.density > 0.8 {
                    0.1 // Too dense, avoid
                } else {
                    1.0 - (zone.density - 0.4).abs() // Peak at 0.4 density
                };

                // Calculate center bias (favor zones near center)
                let center_x = (zone_cols - 1) as f32 / 2.0;
                let center_y = (zone_rows - 1) as f32 / 2.0;
                let dist_from_center =
                    ((zx as f32 - center_x).powi(2) + (zy as f32 - center_y).powi(2)).sqrt();
                let max_dist = ((center_x.powi(2) + center_y.powi(2)).sqrt()).max(1.0);
                let center_factor = 1.0 - (dist_from_center / max_dist) * self.config.center_bias;

                let weight =
                    coldness * (0.5 + neighbor_heat * 0.5) * density_suitability * center_factor;

                if weight > 0.01 {
                    weights.push((zone_idx, weight));
                }
            }
        }

        if weights.is_empty() {
            return None;
        }

        // Weighted random selection
        let total_weight: f32 = weights.iter().map(|(_, w)| w).sum();
        let mut choice = self.rng.random::<f32>() * total_weight;

        // Store last index in case we exhaust all weights
        let last_idx = weights.last().unwrap().0;

        for (idx, weight) in weights {
            choice -= weight;
            if choice <= 0.0 {
                return Some(idx);
            }
        }

        Some(last_idx)
    }

    /// Get average heat of neighboring zones (non-wrapping - only actual neighbors)
    fn get_neighbor_zone_heat(&self, zx: usize, zy: usize, cols: usize, rows: usize) -> f32 {
        let mut total_heat = 0.0;
        let mut count = 0;

        for dy in [-1, 0, 1] {
            for dx in [-1, 0, 1] {
                if dx == 0 && dy == 0 {
                    continue;
                }
                // Only count actual neighbors, don't wrap around
                let nx = zx as isize + dx;
                let ny = zy as isize + dy;

                // Check bounds - skip if outside the grid
                if nx < 0 || nx >= cols as isize || ny < 0 || ny >= rows as isize {
                    continue;
                }

                let nidx = ny as usize * cols + nx as usize;
                if nidx < self.zones.len() {
                    total_heat += self.zones[nidx].heat;
                    count += 1;
                }
            }
        }

        if count > 0 {
            total_heat / count as f32
        } else {
            0.0
        }
    }

    /// Calculate global density (percentage of live cells)
    fn global_density(&self) -> f32 {
        let live_cells = self.cells.iter().filter(|&&c| c).count();
        live_cells as f32 / self.cells.len() as f32
    }

    /// Check if injection should happen and perform it
    pub fn maybe_inject(&mut self) {
        // Only check every N generations
        if self.generation % self.config.check_interval != 0 {
            return;
        }

        // Don't inject if board is already too dense
        let global_density = self.global_density();
        if global_density > 0.15 {
            // Was 0.30 - 15% cap
            return;
        }

        // Calculate global activity
        let total_cells = self.width * self.height;
        let changed_cells: usize = self.zones.iter().map(|z| z.changed_count).sum();
        let global_activity = changed_cells as f32 / total_cells as f32;

        // Calculate deficit and injection chance
        let deficit = (self.config.target_activity - global_activity).max(0.0);
        let chance = (deficit * self.config.injection_gain).min(self.config.max_injection_chance);

        // Random chance check
        if self.rng.random::<f32>() >= chance {
            return;
        }

        // Choose zone
        let Some(zone_idx) = self.choose_injection_zone() else {
            return;
        };

        // Get zone position
        let zone_cols = (self.width + self.config.zone_width - 1) / self.config.zone_width;
        let zy = zone_idx / zone_cols;
        let zx = zone_idx % zone_cols;

        // Choose and place pattern
        let pattern = self.choose_pattern_for_zone(zone_idx);
        let placement = self.choose_placement(zx, zy, &pattern);

        // Place pattern with possible mutation
        self.place_pattern(&pattern, &placement);

        // Record injection
        self.zones[zone_idx].last_injection_generation = self.generation;

        // Apply cooldown
        let cooldown_range = self.config.zone_cooldown_min..=self.config.zone_cooldown_max;
        let cooldown = self.rng.random_range(cooldown_range);
        self.zones[zone_idx].cooldown = cooldown;
    }

    /// Choose a pattern based on zone characteristics
    fn choose_pattern_for_zone(&mut self, zone_idx: usize) -> &'static SeedPattern {
        let zone = &self.zones[zone_idx];

        // Define pattern categories
        const METHUSELAHS: &[&SeedPattern] = &[&R_PENTOMINO_PATTERN, &ACORN_PATTERN];
        const MOVING: &[&SeedPattern] = &[&GLIDER_PATTERN, &LWSS_PATTERN];
        const RANDOM_BLOBS: &[&SeedPattern] =
            &[&RANDOM_BLOB_4X4, &RANDOM_BLOB_5X5, &RANDOM_BLOB_6X6];

        let choices: Vec<&SeedPattern> = if zone.is_cold_empty() {
            // Cold empty: use methuselahs that generate activity
            METHUSELAHS
                .iter()
                .chain(MOVING.iter())
                .chain(RANDOM_BLOBS.iter())
                .copied()
                .collect()
        } else if zone.is_cold_ash() {
            // Cold ash: use moving patterns and blobs to stir up debris
            MOVING.iter().chain(RANDOM_BLOBS.iter()).copied().collect()
        } else {
            // Default: any pattern
            vec![
                &GLIDER_PATTERN,
                &R_PENTOMINO_PATTERN,
                &ACORN_PATTERN,
                &LWSS_PATTERN,
                &RANDOM_BLOB_4X4,
                &RANDOM_BLOB_5X5,
                &RANDOM_BLOB_6X6,
            ]
        };

        // Select random pattern from choices
        let idx = self.rng.random_range(0..choices.len().max(1));
        choices.get(idx).copied().unwrap_or(&GLIDER_PATTERN)
    }

    /// Choose placement parameters for a pattern in a zone
    fn choose_placement(
        &mut self,
        zx: usize,
        zy: usize,
        pattern: &SeedPattern,
    ) -> PatternPlacement {
        // Calculate zone pixel bounds
        let x_start = zx * self.config.zone_width;
        let y_start = zy * self.config.zone_height;
        let x_end = (x_start + self.config.zone_width).min(self.width);
        let y_end = (y_start + self.config.zone_height).min(self.height);

        // Random position within zone (with margin for pattern size)
        let margin_x = pattern.width.min(4);
        let margin_y = pattern.height.min(4);
        let x = if x_end > x_start + margin_x * 2 {
            self.rng.random_range(x_start + margin_x..x_end - margin_x)
        } else {
            x_start
        };
        let y = if y_end > y_start + margin_y * 2 {
            self.rng.random_range(y_start + margin_y..y_end - margin_y)
        } else {
            y_start
        };

        // Random rotation (0-3) and flip
        let rotation = self.rng.random_range(0..4) as u8;
        let flip = self.rng.random::<f32>() < 0.5;

        PatternPlacement {
            pattern: *pattern,
            dx: x as isize,
            dy: y as isize,
            rotation,
            flip,
        }
    }

    /// Place a pattern on the field with optional mutation
    fn place_pattern(&mut self, pattern: &SeedPattern, placement: &PatternPlacement) {
        for &(px, py) in pattern.cells {
            // Apply rotation and flip
            let (rx, ry) = rotate_cell(px, py, pattern.width, pattern.height, placement.rotation);
            let (fx, fy) = if placement.flip {
                (pattern.width - 1 - rx, ry)
            } else {
                (rx, ry)
            };

            // Calculate final position with toroidal wrapping
            let x = wrap_index_signed(placement.dx + fx as isize, self.width);
            let y = wrap_index_signed(placement.dy + fy as isize, self.height);
            let idx = y * self.width + x;

            // Apply mutation chance (randomly skip or add extra cell)
            let mutation = self.rng.random::<f32>() < self.config.mutation_chance;
            if mutation {
                // 50% chance to skip this cell, 50% to also set neighbor
                if self.rng.random::<f32>() < 0.5 {
                    continue; // Skip this cell
                } else {
                    // Set this cell and maybe a neighbor
                    if idx < self.cells.len() {
                        self.cells[idx] = true;
                    }
                    // Occasionally add adjacent cell
                    if self.rng.random::<f32>() < 0.3 {
                        let dx = self.rng.random_range(-1i32..=1) as isize;
                        let dy = self.rng.random_range(-1i32..=1) as isize;
                        let nx = wrap_index_signed(x as isize + dx, self.width);
                        let ny = wrap_index_signed(y as isize + dy, self.height);
                        let nidx = ny * self.width + nx;
                        if nidx < self.cells.len() {
                            self.cells[nidx] = true;
                        }
                    }
                    continue;
                }
            }

            // Normal placement
            if idx < self.cells.len() {
                self.cells[idx] = true;
            }
        }
    }

    /// Remove cells from high-density zones to prevent local sprawl
    fn prune_dense_areas(&mut self) {
        use rand::seq::IteratorRandom;

        let global_density = self.global_density();
        let zone_cols = (self.width + self.config.zone_width - 1) / self.config.zone_width;
        let zone_rows = (self.height + self.config.zone_height - 1) / self.config.zone_height;

        // When global density exceeds 15%, use random global pruning to create "holes"
        // This preserves clusters while creating empty patches (starfield effect)
        if global_density > 0.15 {
            let total_cells = self.width * self.height;
            let target_cells = (total_cells as f32 * 0.12) as usize; // Target 12% density
            let current_live: usize = self.cells.iter().filter(|&&c| c).count();

            if current_live > target_cells {
                let to_remove_total = current_live - target_cells;
                // Remove randomly across entire board to create voids
                let all_live: Vec<usize> = self
                    .cells
                    .iter()
                    .enumerate()
                    .filter(|(_, &c)| c)
                    .map(|(i, _)| i)
                    .collect();

                let mut rng = &mut self.rng;
                for idx in all_live
                    .iter()
                    .sample(&mut rng, to_remove_total.min(all_live.len()))
                {
                    self.cells[*idx] = false;
                }
            }
            return;
        }

        // Normal zone-based pruning for locally dense zones
        for zy in 0..zone_rows {
            for zx in 0..zone_cols {
                let zone_idx = zy * zone_cols + zx;
                let zone = &self.zones[zone_idx];

                if zone.density < self.config.prune_density_threshold {
                    continue;
                }

                // Calculate zone bounds
                let x_start = zx * self.config.zone_width;
                let y_start = zy * self.config.zone_height;
                let x_end = (x_start + self.config.zone_width).min(self.width);
                let y_end = (y_start + self.config.zone_height).min(self.height);

                // Collect live cells in this zone
                let mut live_cells: Vec<(usize, usize)> = Vec::new();
                for y in y_start..y_end {
                    for x in x_start..x_end {
                        let idx = y * self.width + x;
                        if self.cells[idx] {
                            live_cells.push((x, y));
                        }
                    }
                }

                // Randomly remove a percentage of cells
                let to_remove = (live_cells.len() as f32 * self.config.prune_percentage) as usize;
                let mut rng = &mut self.rng;
                for (x, y) in live_cells.iter().sample(&mut rng, to_remove) {
                    let idx = y * self.width + x;
                    self.cells[idx] = false;
                }
            }
        }
    }

    /// Periodically rebalance cell distribution to prevent drift accumulation
    fn rebalance(&mut self) {
        if self.generation % self.config.rebalance_interval != 0 {
            return;
        }

        // Count cells in each third
        let third_width = self.width / 3;
        let left_count = self.count_cells_in_region(0, third_width);
        let center_count = self.count_cells_in_region(third_width, third_width * 2);
        let right_count = self.count_cells_in_region(third_width * 2, self.width);

        let total = left_count + center_count + right_count;
        if total == 0 {
            return;
        }

        let left_pct = left_count as f32 / total as f32;
        let center_pct = center_count as f32 / total as f32;
        let right_pct = right_count as f32 / total as f32;

        // If any region has >40% of cells, prune it
        let threshold = 0.40;
        if left_pct > threshold {
            let to_prune = ((left_pct - 0.33) * total as f32) as usize;
            self.prune_region(0, third_width, to_prune);
        }
        if center_pct > threshold {
            let to_prune = ((center_pct - 0.33) * total as f32) as usize;
            self.prune_region(third_width, third_width * 2, to_prune);
        }
        if right_pct > threshold {
            let to_prune = ((right_pct - 0.33) * total as f32) as usize;
            self.prune_region(third_width * 2, self.width, to_prune);
        }
    }

    /// Count live cells in a horizontal region [x_start, x_end)
    fn count_cells_in_region(&self, x_start: usize, x_end: usize) -> usize {
        let x_start = x_start.min(self.width);
        let x_end = x_end.min(self.width);
        if x_start >= x_end {
            return 0;
        }

        let mut count = 0;
        for y in 0..self.height {
            for x in x_start..x_end {
                let idx = y * self.width + x;
                if self.cells[idx] {
                    count += 1;
                }
            }
        }
        count
    }

    /// Prune random cells from a horizontal region [x_start, x_end)
    fn prune_region(&mut self, x_start: usize, x_end: usize, count: usize) {
        use rand::seq::IteratorRandom;

        let x_start = x_start.min(self.width);
        let x_end = x_end.min(self.width);
        if x_start >= x_end || count == 0 {
            return;
        }

        // Collect live cells in the region
        let mut live_cells: Vec<usize> = Vec::new();
        for y in 0..self.height {
            for x in x_start..x_end {
                let idx = y * self.width + x;
                if self.cells[idx] {
                    live_cells.push(idx);
                }
            }
        }

        // Randomly remove 'count' cells (or all if fewer available)
        let to_remove = count.min(live_cells.len());
        let mut rng = &mut self.rng;
        for idx in live_cells.iter().sample(&mut rng, to_remove) {
            self.cells[*idx] = false;
        }
    }

    /// Get the current generation counter
    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// Get field dimensions
    pub fn dimensions(&self) -> (usize, usize) {
        (self.width, self.height)
    }

    /// Get all live cell positions
    pub fn live_cells(&self) -> Vec<(usize, usize)> {
        let mut cells = Vec::new();
        for y in 0..self.height {
            for x in 0..self.width {
                let idx = y * self.width + x;
                if idx < self.cells.len() && self.cells[idx] {
                    cells.push((x, y));
                }
            }
        }
        cells
    }

    /// Get the number of live cells
    pub fn live_cell_count(&self) -> usize {
        self.cells.iter().filter(|&&c| c).count()
    }

    /// Get zone statistics for debugging
    pub fn zone_stats(&self) -> Vec<((usize, usize), ZoneStats)> {
        let zone_cols = (self.width + self.config.zone_width - 1) / self.config.zone_width;
        let zone_rows = (self.height + self.config.zone_height - 1) / self.config.zone_height;

        let mut result = Vec::new();
        for zy in 0..zone_rows {
            for zx in 0..zone_cols {
                let zone_idx = zy * zone_cols + zx;
                if zone_idx < self.zones.len() {
                    result.push(((zx, zy), self.zones[zone_idx]));
                }
            }
        }
        result
    }

    /// Get configuration
    pub fn config(&self) -> &LifeConfig {
        &self.config
    }
}

/// Wraps an index with a delta, handling toroidal boundaries.
///
/// # Arguments
/// * `index` - Starting index
/// * `delta` - Offset to apply (can be negative)
/// * `len` - Length of the dimension
///
/// # Returns
/// Wrapped index within [0, len)
pub fn wrap_index(index: usize, delta: isize, len: usize) -> usize {
    if len == 0 {
        return 0;
    }
    ((index as isize + delta).rem_euclid(len as isize)) as usize
}

/// Wraps a signed index, handling toroidal boundaries.
///
/// # Arguments
/// * `index` - Signed index (can be negative)
/// * `len` - Length of the dimension
///
/// # Returns
/// Wrapped index within [0, len)
pub fn wrap_index_signed(index: isize, len: usize) -> usize {
    if len == 0 {
        return 0;
    }
    index.rem_euclid(len as isize) as usize
}

/// Calculates dimensions after rotation.
///
/// # Arguments
/// * `width` - Original width
/// * `height` - Original height
/// * `rotation` - Rotation in 90-degree increments (0-3)
///
/// # Returns
/// (width, height) after rotation
pub fn rotated_dimensions(width: usize, height: usize, rotation: u8) -> (usize, usize) {
    if rotation % 2 == 0 {
        (width, height)
    } else {
        (height, width)
    }
}

/// Rotates a cell coordinate within a pattern.
///
/// # Arguments
/// * `x` - Original X coordinate
/// * `y` - Original Y coordinate
/// * `width` - Pattern width
/// * `height` - Pattern height
/// * `rotation` - Rotation in 90-degree increments (0-3)
///
/// # Returns
/// Rotated (x, y) coordinates
pub fn rotate_cell(
    x: usize,
    y: usize,
    width: usize,
    height: usize,
    rotation: u8,
) -> (usize, usize) {
    match rotation % 4 {
        0 => (x, y),
        1 => (height.saturating_sub(1).saturating_sub(y), x),
        2 => (
            width.saturating_sub(1).saturating_sub(x),
            height.saturating_sub(1).saturating_sub(y),
        ),
        _ => (y, width.saturating_sub(1).saturating_sub(x)),
    }
}
