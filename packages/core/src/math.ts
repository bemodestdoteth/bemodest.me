export function formatNumber(number: number): string {
  const n = Number(number);
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

export function negativePowerOf10(number: number): number | string {
  let n = Number(number);
  if (n === 0) {
    return "Undefined";
  } else if (n === 1) {
    return 0.0;
  }

  let count = 0;
  if (n > 1) {
    while (n > 1) {
      n /= 10;
      count += 1;
    }
    return -count;
  } else if (n > 0 && n < 1) {
    while (n < 1) {
      n *= 10;
      count += 1;
    }
    return count;
  }
  return count;
}

export function num2Hex(num: number): string {
  if (num < 0 || num > 15) {
    throw new RangeError(`num2Hex: num must be between 0 and 15, got ${num}`);
  }
  if (num < 10) {
    return String(num);
  }
  const strs = "ABCDEF";
  return strs[num - 10];
}

export function roundDown(num: number, digits: number): number {
  return Math.floor(num * 10 ** digits) / 10 ** digits;
}

export function parseNumber(number: number): string {
  if (number === 0) {
    return "$0\\.0000";
  } else if (number >= 1000) {
    return `${Math.round(number).toLocaleString("en-US")}`.replace(/\./g, "\\.");
  } else if (number >= 1) {
    return `${number.toPrecision(4)}`.replace(/\./g, "\\.");
  } else if (number >= 0.01) {
    return `${number.toFixed(4)}`.replace(/\./g, "\\.");
  } else {
    const numberStr = number.toFixed(16);
    let nonZeroIndex = 0;
    for (let i = 0; i < numberStr.length; i++) {
      const ch = numberStr[i];
      if (ch !== "0" && ch !== ".") {
        nonZeroIndex = i;
        break;
      }
    }
    // Number is too small for 16 decimal places (e.g., 1e-20)
    if (nonZeroIndex === 0) {
      return `$${number.toExponential(4).replace(/\./g, "\\.")}`;
    }
    let zerosCount = String(nonZeroIndex - 2);

    const superscriptMap: Record<string, string> = {
      "0": "⁰",
      "1": "¹",
      "2": "²",
      "3": "³",
      "4": "⁴",
      "5": "⁵",
      "6": "⁶",
      "7": "⁷",
      "8": "⁸",
      "9": "⁹",
    };
    zerosCount = zerosCount
      .split("")
      .map((c) => superscriptMap[c])
      .join("");

    const numberTail = parseFloat(
      "0." + numberStr.slice(nonZeroIndex, nonZeroIndex + 5)
    );
    const significantDigits = numberTail.toFixed(3).slice(2);

    return `${0}\\.0${zerosCount}${significantDigits}`;
  }
}
