function shuffle<T>(random: () => number, array: T[]): void {
    let currentIndex = array.length;

    // For each elements starting from the end.
    while (currentIndex != 0) {
        // Pick a random element from the remaining elements.
        const randomIndex = Math.floor(currentIndex * random());
        currentIndex--;
        // Swap the current element with the random element.
        [array[currentIndex]!, array[randomIndex]!] = [
            array[randomIndex]!, array[currentIndex]!];
    }
}
function print(...args: unknown[]): void {
    console.log(...args);
}

export { shuffle, print };
