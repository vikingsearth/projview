from dataclasses import dataclass


@dataclass
class Row:
    name: str
    count: int


def total(rows: list[Row]) -> int:
    """sum of every row's count"""
    return sum(r.count for r in rows)
