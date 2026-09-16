import type { Card } from '../shared/protocol.ts'
export const suitSymbols = { S: '♠', H: '♥', D: '♦', C: '♣' }
export function cardLabel(card: Card) {
  return `${suitSymbols[card[0] as keyof typeof suitSymbols]}${card.slice(1)}`
}
