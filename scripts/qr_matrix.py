"""Generate compact QR code half-row state digits for terminal rendering."""
import sys

import qrcode


def build_qr_digit_rows(payload: str) -> list[str]:
    """Encode payload into 2-module-tall terminal digit rows ('0'..'3')."""
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_L,
        box_size=1,
        border=2,
    )
    qr.add_data(payload)
    qr.make(fit=True)

    matrix = qr.get_matrix()
    padded = [[False, *row, False] for row in matrix]
    width = len(padded[0])
    height = len(padded)
    rows: list[str] = []

    for r in range(0, height, 2):
        top_row = padded[r]
        bot_row = padded[r + 1] if (r + 1) < height else [False] * width
        chars: list[str] = []
        for top, bot in zip(top_row, bot_row):
            if not top and not bot:
                chars.append("0")
            elif top and not bot:
                chars.append("1")
            elif not top and bot:
                chars.append("2")
            else:
                chars.append("3")
        rows.append("".join(chars))
    return rows


def main() -> int:
    """CLI entry accepting URL argument and printing ASCII digit lines."""
    if len(sys.argv) < 2 or not sys.argv[1].strip():
        return 1
    for line in build_qr_digit_rows(sys.argv[1].strip()):
        print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
