//! Conway's Game of Life implementation for TUI background animation.
//!
//! This module provides a cellular automaton simulation using Braille patterns
//! for rendering. It includes various seed patterns (gliders, spaceships, etc.)
//! and automatic pattern injection when activity becomes low.

use rand::rngs::StdRng;
use rand::RngExt;
use rand::SeedableRng;
use ratatui::text::{Line, Span};

mod field;
mod math;
mod patterns;
mod render;

pub use field::{LifeConfig, LifeField, ZoneStats};
pub use math::*;
pub use patterns::*;
