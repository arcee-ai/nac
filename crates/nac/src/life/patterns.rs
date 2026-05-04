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
