import csv
import math
import random
from datetime import datetime, timedelta


def generate_signal_data(file_path: str, start_date: datetime) -> None:
    """
    Generate one day of 5-channel signal data at 1-minute intervals.

    The data is formatted with columns: datetime, signal_name, signal_value.
    It sequentially writes all records for one channel before appending the next.

    :param file_path: The path to the output CSV file.
    :param start_date: The starting datetime for the generated data.
    """
    channels: list[str] = ["signal_1", "signal_2", "signal_3", "signal_4", "signal_5"]
    minutes_in_day: int = 24 * 60

    with open(file_path, mode="w", newline="", encoding="utf-8") as csv_file:
        writer = csv.writer(csv_file)
        writer.writerow(["datetime", "signal_name", "signal_value"])

        for channel in channels:
            for minute in range(minutes_in_day):
                current_time: datetime = start_date + timedelta(minutes=minute)

                # Mock signal: sine wave with slight randomness, varied by channel
                channel_idx = channels.index(channel) + 1
                value: float = math.sin(minute * 0.05 * channel_idx) + random.uniform(-0.1, 0.1)

                writer.writerow(
                    [
                        current_time.strftime("%Y-%m-%d %H:%M:%S"),
                        channel,
                        f"{value:.4f}",
                    ]
                )


if __name__ == "__main__":
    # Generate data starting from today at midnight
    start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    generate_signal_data("signal_data.csv", start)
