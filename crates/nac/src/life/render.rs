use super::*;

impl LifeField {
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
}
