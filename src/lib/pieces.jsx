import React from 'react';
import { PIECE_ART } from './pieceArt.gen.js';
import {
  DEFAULT_PIECE_LIGHT, DEFAULT_PIECE_DARK, THEME_DRAWING_FILTERS, isPieceStyle, drawnByTrees, fitViewBox, literalColor,
  filterColor,
} from './pieceStyles';

export { DEFAULT_PIECE_LIGHT, DEFAULT_PIECE_DARK };

// The board's pieces: every set a board can draw (src/lib/pieceStyles.js says
// which one, lib/theme.js boardPieces() hands over its look).
//
// The Default and Court Cards sets are react-chessboard's own default pieces
// (the Cburnett set) lifted out of the package and re-emitted here as data
// (TREES), so the colours can be swapped without losing any of the artwork.
// Extracting them was necessary because the two inks aren't simply "the white
// piece" and "the black piece": detail paths carry `fill: none` and are drawn
// in the opposite ink, so a blanket CSS override flattens the crowns, crosses
// and knight manes into solid blobs.
//
// 'LIGHT' and 'DARK' stand in for every #ffffff and #000000 in the original. A
// white piece is filled with LIGHT and outlined in DARK; a black piece is
// filled with DARK and detailed in LIGHT. Recolouring both inks together is
// what keeps a set looking designed rather than tinted.
//
// Every other set is Chess Arcade's own drawings (PIECE_ART, trees made by
// `npm run sync:pieces`, so nothing is parsed here). Their colors are CSS
// variables with the set's own colors as fallbacks (var(--pw-white-fill, …)):
// a theme's piece colors reach them from <html> (applySkin). They're drawn in
// a fitted viewBox (pieceStyles' fitViewBox), the size Repertoire Lab draws
// its pieces at.
const TREES = {"wP":{"t":"svg","p":{"xmlns":"http://www.w3.org/2000/svg","version":"1.1","width":"45","height":"45"},"c":{"t":"path","p":{"d":"m 22.5,9 c -2.21,0 -4,1.79 -4,4 0,0.89 0.29,1.71 0.78,2.38 C 17.33,16.5 16,18.59 16,21 c 0,2.03 0.94,3.84 2.41,5.03 C 15.41,27.09 11,31.58 11,39.5 H 34 C 34,31.58 29.59,27.09 26.59,26.03 28.06,24.84 29,23.03 29,21 29,18.59 27.67,16.5 25.72,15.38 26.21,14.71 26.5,13.89 26.5,13 c 0,-2.21 -1.79,-4 -4,-4 z","style":{"opacity":"1","fill":"LIGHT","fillOpacity":"1","fillRule":"nonzero","stroke":"DARK","strokeWidth":"1.5","strokeLinecap":"round","strokeLinejoin":"miter","strokeMiterlimit":"4","strokeDasharray":"none","strokeOpacity":"1"}}}},"wR":{"t":"svg","p":{"xmlns":"http://www.w3.org/2000/svg","version":"1.1","width":"45","height":"45"},"c":{"t":"g","p":{"style":{"opacity":"1","fill":"LIGHT","fillOpacity":"1","fillRule":"evenodd","stroke":"DARK","strokeWidth":"1.5","strokeLinecap":"round","strokeLinejoin":"round","strokeMiterlimit":"4","strokeDasharray":"none","strokeOpacity":"1"}},"c":[{"t":"path","p":{"d":"M 9,39 L 36,39 L 36,36 L 9,36 L 9,39 z ","style":{"strokeLinecap":"butt"}}},{"t":"path","p":{"d":"M 12,36 L 12,32 L 33,32 L 33,36 L 12,36 z ","style":{"strokeLinecap":"butt"}}},{"t":"path","p":{"d":"M 11,14 L 11,9 L 15,9 L 15,11 L 20,11 L 20,9 L 25,9 L 25,11 L 30,11 L 30,9 L 34,9 L 34,14","style":{"strokeLinecap":"butt"}}},{"t":"path","p":{"d":"M 34,14 L 31,17 L 14,17 L 11,14"}},{"t":"path","p":{"d":"M 31,17 L 31,29.5 L 14,29.5 L 14,17","style":{"strokeLinecap":"butt","strokeLinejoin":"miter"}}},{"t":"path","p":{"d":"M 31,29.5 L 32.5,32 L 12.5,32 L 14,29.5"}},{"t":"path","p":{"d":"M 11,14 L 34,14","style":{"fill":"none","stroke":"DARK","strokeLinejoin":"miter"}}}]}},"wN":{"t":"svg","p":{"xmlns":"http://www.w3.org/2000/svg","version":"1.1","width":"45","height":"45"},"c":{"t":"g","p":{"style":{"opacity":"1","fill":"none","fillOpacity":"1","fillRule":"evenodd","stroke":"DARK","strokeWidth":"1.5","strokeLinecap":"round","strokeLinejoin":"round","strokeMiterlimit":"4","strokeDasharray":"none","strokeOpacity":"1"}},"c":[{"t":"path","p":{"d":"M 22,10 C 32.5,11 38.5,18 38,39 L 15,39 C 15,30 25,32.5 23,18","style":{"fill":"LIGHT","stroke":"DARK"}}},{"t":"path","p":{"d":"M 24,18 C 24.38,20.91 18.45,25.37 16,27 C 13,29 13.18,31.34 11,31 C 9.958,30.06 12.41,27.96 11,28 C 10,28 11.19,29.23 10,30 C 9,30 5.997,31 6,26 C 6,24 12,14 12,14 C 12,14 13.89,12.1 14,10.5 C 13.27,9.506 13.5,8.5 13.5,7.5 C 14.5,6.5 16.5,10 16.5,10 L 18.5,10 C 18.5,10 19.28,8.008 21,7 C 22,7 22,10 22,10","style":{"fill":"LIGHT","stroke":"DARK"}}},{"t":"path","p":{"d":"M 9.5 25.5 A 0.5 0.5 0 1 1 8.5,25.5 A 0.5 0.5 0 1 1 9.5 25.5 z","style":{"fill":"DARK","stroke":"DARK"}}},{"t":"path","p":{"d":"M 15 15.5 A 0.5 1.5 0 1 1  14,15.5 A 0.5 1.5 0 1 1  15 15.5 z","transform":"matrix(0.866,0.5,-0.5,0.866,9.693,-5.173)","style":{"fill":"DARK","stroke":"DARK"}}}]}},"wB":{"t":"svg","p":{"xmlns":"http://www.w3.org/2000/svg","version":"1.1","width":"45","height":"45"},"c":{"t":"g","p":{"style":{"opacity":"1","fill":"none","fillRule":"evenodd","fillOpacity":"1","stroke":"DARK","strokeWidth":"1.5","strokeLinecap":"round","strokeLinejoin":"round","strokeMiterlimit":"4","strokeDasharray":"none","strokeOpacity":"1"}},"c":[{"t":"g","p":{"style":{"fill":"LIGHT","stroke":"DARK","strokeLinecap":"butt"}},"c":[{"t":"path","p":{"d":"M 9,36 C 12.39,35.03 19.11,36.43 22.5,34 C 25.89,36.43 32.61,35.03 36,36 C 36,36 37.65,36.54 39,38 C 38.32,38.97 37.35,38.99 36,38.5 C 32.61,37.53 25.89,38.96 22.5,37.5 C 19.11,38.96 12.39,37.53 9,38.5 C 7.65,38.99 6.68,38.97 6,38 C 7.35,36.54 9,36 9,36 z"}},{"t":"path","p":{"d":"M 15,32 C 17.5,34.5 27.5,34.5 30,32 C 30.5,30.5 30,30 30,30 C 30,27.5 27.5,26 27.5,26 C 33,24.5 33.5,14.5 22.5,10.5 C 11.5,14.5 12,24.5 17.5,26 C 17.5,26 15,27.5 15,30 C 15,30 14.5,30.5 15,32 z"}},{"t":"path","p":{"d":"M 25 8 A 2.5 2.5 0 1 1  20,8 A 2.5 2.5 0 1 1  25 8 z"}}]},{"t":"path","p":{"d":"M 17.5,26 L 27.5,26 M 15,30 L 30,30 M 22.5,15.5 L 22.5,20.5 M 20,18 L 25,18","style":{"fill":"none","stroke":"DARK","strokeLinejoin":"miter"}}}]}},"wQ":{"t":"svg","p":{"xmlns":"http://www.w3.org/2000/svg","version":"1.1","width":"45","height":"45"},"c":{"t":"g","p":{"style":{"fill":"LIGHT","stroke":"DARK","strokeWidth":"1.5","strokeLinejoin":"round"}},"c":[{"t":"path","p":{"d":"M 9,26 C 17.5,24.5 30,24.5 36,26 L 38.5,13.5 L 31,25 L 30.7,10.9 L 25.5,24.5 L 22.5,10 L 19.5,24.5 L 14.3,10.9 L 14,25 L 6.5,13.5 L 9,26 z"}},{"t":"path","p":{"d":"M 9,26 C 9,28 10.5,28 11.5,30 C 12.5,31.5 12.5,31 12,33.5 C 10.5,34.5 11,36 11,36 C 9.5,37.5 11,38.5 11,38.5 C 17.5,39.5 27.5,39.5 34,38.5 C 34,38.5 35.5,37.5 34,36 C 34,36 34.5,34.5 33,33.5 C 32.5,31 32.5,31.5 33.5,30 C 34.5,28 36,28 36,26 C 27.5,24.5 17.5,24.5 9,26 z"}},{"t":"path","p":{"d":"M 11.5,30 C 15,29 30,29 33.5,30","style":{"fill":"none"}}},{"t":"path","p":{"d":"M 12,33.5 C 18,32.5 27,32.5 33,33.5","style":{"fill":"none"}}},{"t":"circle","p":{"cx":"6","cy":"12","r":"2"}},{"t":"circle","p":{"cx":"14","cy":"9","r":"2"}},{"t":"circle","p":{"cx":"22.5","cy":"8","r":"2"}},{"t":"circle","p":{"cx":"31","cy":"9","r":"2"}},{"t":"circle","p":{"cx":"39","cy":"12","r":"2"}}]}},"wK":{"t":"svg","p":{"xmlns":"http://www.w3.org/2000/svg","version":"1.1","width":"45","height":"45"},"c":{"t":"g","p":{"style":{"fill":"none","fillOpacity":"1","fillRule":"evenodd","stroke":"DARK","strokeWidth":"1.5","strokeLinecap":"round","strokeLinejoin":"round","strokeMiterlimit":"4","strokeDasharray":"none","strokeOpacity":"1"}},"c":[{"t":"path","p":{"d":"M 22.5,11.63 L 22.5,6","style":{"fill":"none","stroke":"DARK","strokeLinejoin":"miter"}}},{"t":"path","p":{"d":"M 20,8 L 25,8","style":{"fill":"none","stroke":"DARK","strokeLinejoin":"miter"}}},{"t":"path","p":{"d":"M 22.5,25 C 22.5,25 27,17.5 25.5,14.5 C 25.5,14.5 24.5,12 22.5,12 C 20.5,12 19.5,14.5 19.5,14.5 C 18,17.5 22.5,25 22.5,25","style":{"fill":"LIGHT","stroke":"DARK","strokeLinecap":"butt","strokeLinejoin":"miter"}}},{"t":"path","p":{"d":"M 12.5,37 C 18,40.5 27,40.5 32.5,37 L 32.5,30 C 32.5,30 41.5,25.5 38.5,19.5 C 34.5,13 25,16 22.5,23.5 L 22.5,27 L 22.5,23.5 C 20,16 10.5,13 6.5,19.5 C 3.5,25.5 12.5,30 12.5,30 L 12.5,37","style":{"fill":"LIGHT","stroke":"DARK"}}},{"t":"path","p":{"d":"M 12.5,30 C 18,27 27,27 32.5,30","style":{"fill":"none","stroke":"DARK"}}},{"t":"path","p":{"d":"M 12.5,33.5 C 18,30.5 27,30.5 32.5,33.5","style":{"fill":"none","stroke":"DARK"}}},{"t":"path","p":{"d":"M 12.5,37 C 18,34 27,34 32.5,37","style":{"fill":"none","stroke":"DARK"}}}]}},"bP":{"t":"svg","p":{"xmlns":"http://www.w3.org/2000/svg","version":"1.1","width":"45","height":"45"},"c":{"t":"path","p":{"d":"m 22.5,9 c -2.21,0 -4,1.79 -4,4 0,0.89 0.29,1.71 0.78,2.38 C 17.33,16.5 16,18.59 16,21 c 0,2.03 0.94,3.84 2.41,5.03 C 15.41,27.09 11,31.58 11,39.5 H 34 C 34,31.58 29.59,27.09 26.59,26.03 28.06,24.84 29,23.03 29,21 29,18.59 27.67,16.5 25.72,15.38 26.21,14.71 26.5,13.89 26.5,13 c 0,-2.21 -1.79,-4 -4,-4 z","style":{"opacity":"1","fill":"DARK","fillOpacity":"1","fillRule":"nonzero","stroke":"DARK","strokeWidth":"1.5","strokeLinecap":"round","strokeLinejoin":"miter","strokeMiterlimit":"4","strokeDasharray":"none","strokeOpacity":"1"}}}},"bR":{"t":"svg","p":{"xmlns":"http://www.w3.org/2000/svg","version":"1.1","width":"45","height":"45"},"c":{"t":"g","p":{"style":{"opacity":"1","fill":"DARK","fillOpacity":"1","fillRule":"evenodd","stroke":"DARK","strokeWidth":"1.5","strokeLinecap":"round","strokeLinejoin":"round","strokeMiterlimit":"4","strokeDasharray":"none","strokeOpacity":"1"}},"c":[{"t":"path","p":{"d":"M 9,39 L 36,39 L 36,36 L 9,36 L 9,39 z ","style":{"strokeLinecap":"butt"}}},{"t":"path","p":{"d":"M 12.5,32 L 14,29.5 L 31,29.5 L 32.5,32 L 12.5,32 z ","style":{"strokeLinecap":"butt"}}},{"t":"path","p":{"d":"M 12,36 L 12,32 L 33,32 L 33,36 L 12,36 z ","style":{"strokeLinecap":"butt"}}},{"t":"path","p":{"d":"M 14,29.5 L 14,16.5 L 31,16.5 L 31,29.5 L 14,29.5 z ","style":{"strokeLinecap":"butt","strokeLinejoin":"miter"}}},{"t":"path","p":{"d":"M 14,16.5 L 11,14 L 34,14 L 31,16.5 L 14,16.5 z ","style":{"strokeLinecap":"butt"}}},{"t":"path","p":{"d":"M 11,14 L 11,9 L 15,9 L 15,11 L 20,11 L 20,9 L 25,9 L 25,11 L 30,11 L 30,9 L 34,9 L 34,14 L 11,14 z ","style":{"strokeLinecap":"butt"}}},{"t":"path","p":{"d":"M 12,35.5 L 33,35.5 L 33,35.5","style":{"fill":"none","stroke":"LIGHT","strokeWidth":"1","strokeLinejoin":"miter"}}},{"t":"path","p":{"d":"M 13,31.5 L 32,31.5","style":{"fill":"none","stroke":"LIGHT","strokeWidth":"1","strokeLinejoin":"miter"}}},{"t":"path","p":{"d":"M 14,29.5 L 31,29.5","style":{"fill":"none","stroke":"LIGHT","strokeWidth":"1","strokeLinejoin":"miter"}}},{"t":"path","p":{"d":"M 14,16.5 L 31,16.5","style":{"fill":"none","stroke":"LIGHT","strokeWidth":"1","strokeLinejoin":"miter"}}},{"t":"path","p":{"d":"M 11,14 L 34,14","style":{"fill":"none","stroke":"LIGHT","strokeWidth":"1","strokeLinejoin":"miter"}}}]}},"bN":{"t":"svg","p":{"xmlns":"http://www.w3.org/2000/svg","version":"1.1","width":"45","height":"45"},"c":{"t":"g","p":{"style":{"opacity":"1","fill":"none","fillOpacity":"1","fillRule":"evenodd","stroke":"DARK","strokeWidth":"1.5","strokeLinecap":"round","strokeLinejoin":"round","strokeMiterlimit":"4","strokeDasharray":"none","strokeOpacity":"1"}},"c":[{"t":"path","p":{"d":"M 22,10 C 32.5,11 38.5,18 38,39 L 15,39 C 15,30 25,32.5 23,18","style":{"fill":"DARK","stroke":"DARK"}}},{"t":"path","p":{"d":"M 24,18 C 24.38,20.91 18.45,25.37 16,27 C 13,29 13.18,31.34 11,31 C 9.958,30.06 12.41,27.96 11,28 C 10,28 11.19,29.23 10,30 C 9,30 5.997,31 6,26 C 6,24 12,14 12,14 C 12,14 13.89,12.1 14,10.5 C 13.27,9.506 13.5,8.5 13.5,7.5 C 14.5,6.5 16.5,10 16.5,10 L 18.5,10 C 18.5,10 19.28,8.008 21,7 C 22,7 22,10 22,10","style":{"fill":"DARK","stroke":"DARK"}}},{"t":"path","p":{"d":"M 9.5 25.5 A 0.5 0.5 0 1 1 8.5,25.5 A 0.5 0.5 0 1 1 9.5 25.5 z","style":{"fill":"LIGHT","stroke":"LIGHT"}}},{"t":"path","p":{"d":"M 15 15.5 A 0.5 1.5 0 1 1  14,15.5 A 0.5 1.5 0 1 1  15 15.5 z","transform":"matrix(0.866,0.5,-0.5,0.866,9.693,-5.173)","style":{"fill":"LIGHT","stroke":"LIGHT"}}},{"t":"path","p":{"d":"M 24.55,10.4 L 24.1,11.85 L 24.6,12 C 27.75,13 30.25,14.49 32.5,18.75 C 34.75,23.01 35.75,29.06 35.25,39 L 35.2,39.5 L 37.45,39.5 L 37.5,39 C 38,28.94 36.62,22.15 34.25,17.66 C 31.88,13.17 28.46,11.02 25.06,10.5 L 24.55,10.4 z ","style":{"fill":"LIGHT","stroke":"none"}}}]}},"bB":{"t":"svg","p":{"xmlns":"http://www.w3.org/2000/svg","version":"1.1","width":"45","height":"45"},"c":{"t":"g","p":{"style":{"opacity":"1","fill":"none","fillRule":"evenodd","fillOpacity":"1","stroke":"DARK","strokeWidth":"1.5","strokeLinecap":"round","strokeLinejoin":"round","strokeMiterlimit":"4","strokeDasharray":"none","strokeOpacity":"1"}},"c":[{"t":"g","p":{"style":{"fill":"DARK","stroke":"DARK","strokeLinecap":"butt"}},"c":[{"t":"path","p":{"d":"M 9,36 C 12.39,35.03 19.11,36.43 22.5,34 C 25.89,36.43 32.61,35.03 36,36 C 36,36 37.65,36.54 39,38 C 38.32,38.97 37.35,38.99 36,38.5 C 32.61,37.53 25.89,38.96 22.5,37.5 C 19.11,38.96 12.39,37.53 9,38.5 C 7.65,38.99 6.68,38.97 6,38 C 7.35,36.54 9,36 9,36 z"}},{"t":"path","p":{"d":"M 15,32 C 17.5,34.5 27.5,34.5 30,32 C 30.5,30.5 30,30 30,30 C 30,27.5 27.5,26 27.5,26 C 33,24.5 33.5,14.5 22.5,10.5 C 11.5,14.5 12,24.5 17.5,26 C 17.5,26 15,27.5 15,30 C 15,30 14.5,30.5 15,32 z"}},{"t":"path","p":{"d":"M 25 8 A 2.5 2.5 0 1 1  20,8 A 2.5 2.5 0 1 1  25 8 z"}}]},{"t":"path","p":{"d":"M 17.5,26 L 27.5,26 M 15,30 L 30,30 M 22.5,15.5 L 22.5,20.5 M 20,18 L 25,18","style":{"fill":"none","stroke":"LIGHT","strokeLinejoin":"miter"}}}]}},"bQ":{"t":"svg","p":{"xmlns":"http://www.w3.org/2000/svg","version":"1.1","width":"45","height":"45"},"c":{"t":"g","p":{"style":{"fill":"DARK","stroke":"DARK","strokeWidth":"1.5","strokeLinecap":"round","strokeLinejoin":"round"}},"c":[{"t":"path","p":{"d":"M 9,26 C 17.5,24.5 30,24.5 36,26 L 38.5,13.5 L 31,25 L 30.7,10.9 L 25.5,24.5 L 22.5,10 L 19.5,24.5 L 14.3,10.9 L 14,25 L 6.5,13.5 L 9,26 z","style":{"strokeLinecap":"butt","fill":"DARK"}}},{"t":"path","p":{"d":"m 9,26 c 0,2 1.5,2 2.5,4 1,1.5 1,1 0.5,3.5 -1.5,1 -1,2.5 -1,2.5 -1.5,1.5 0,2.5 0,2.5 6.5,1 16.5,1 23,0 0,0 1.5,-1 0,-2.5 0,0 0.5,-1.5 -1,-2.5 -0.5,-2.5 -0.5,-2 0.5,-3.5 1,-2 2.5,-2 2.5,-4 -8.5,-1.5 -18.5,-1.5 -27,0 z"}},{"t":"path","p":{"d":"M 11.5,30 C 15,29 30,29 33.5,30"}},{"t":"path","p":{"d":"m 12,33.5 c 6,-1 15,-1 21,0"}},{"t":"circle","p":{"cx":"6","cy":"12","r":"2"}},{"t":"circle","p":{"cx":"14","cy":"9","r":"2"}},{"t":"circle","p":{"cx":"22.5","cy":"8","r":"2"}},{"t":"circle","p":{"cx":"31","cy":"9","r":"2"}},{"t":"circle","p":{"cx":"39","cy":"12","r":"2"}},{"t":"path","p":{"d":"M 11,38.5 A 35,35 1 0 0 34,38.5","style":{"fill":"none","stroke":"DARK","strokeLinecap":"butt"}}},{"t":"g","p":{"style":{"fill":"none","stroke":"LIGHT"}},"c":[{"t":"path","p":{"d":"M 11,29 A 35,35 1 0 1 34,29"}},{"t":"path","p":{"d":"M 12.5,31.5 L 32.5,31.5"}},{"t":"path","p":{"d":"M 11.5,34.5 A 35,35 1 0 0 33.5,34.5"}},{"t":"path","p":{"d":"M 10.5,37.5 A 35,35 1 0 0 34.5,37.5"}}]}]}},"bK":{"t":"svg","p":{"xmlns":"http://www.w3.org/2000/svg","version":"1.1","width":"45","height":"45"},"c":{"t":"g","p":{"style":{"fill":"none","fillOpacity":"1","fillRule":"evenodd","stroke":"DARK","strokeWidth":"1.5","strokeLinecap":"round","strokeLinejoin":"round","strokeMiterlimit":"4","strokeDasharray":"none","strokeOpacity":"1"}},"c":[{"t":"path","p":{"d":"M 22.5,11.63 L 22.5,6","style":{"fill":"none","stroke":"DARK","strokeLinejoin":"miter"},"id":"path6570"}},{"t":"path","p":{"d":"M 22.5,25 C 22.5,25 27,17.5 25.5,14.5 C 25.5,14.5 24.5,12 22.5,12 C 20.5,12 19.5,14.5 19.5,14.5 C 18,17.5 22.5,25 22.5,25","style":{"fill":"DARK","fillOpacity":"1","strokeLinecap":"butt","strokeLinejoin":"miter"}}},{"t":"path","p":{"d":"M 12.5,37 C 18,40.5 27,40.5 32.5,37 L 32.5,30 C 32.5,30 41.5,25.5 38.5,19.5 C 34.5,13 25,16 22.5,23.5 L 22.5,27 L 22.5,23.5 C 20,16 10.5,13 6.5,19.5 C 3.5,25.5 12.5,30 12.5,30 L 12.5,37","style":{"fill":"DARK","stroke":"DARK"}}},{"t":"path","p":{"d":"M 20,8 L 25,8","style":{"fill":"none","stroke":"DARK","strokeLinejoin":"miter"}}},{"t":"path","p":{"d":"M 32,29.5 C 32,29.5 40.5,25.5 38.03,19.85 C 34.15,14 25,18 22.5,24.5 L 22.5,26.6 L 22.5,24.5 C 20,18 10.85,14 6.97,19.85 C 4.5,25.5 13,29.5 13,29.5","style":{"fill":"none","stroke":"LIGHT"}}},{"t":"path","p":{"d":"M 12.5,30 C 18,27 27,27 32.5,30 M 12.5,33.5 C 18,30.5 27,30.5 32.5,33.5 M 12.5,37 C 18,34 27,34 32.5,37","style":{"fill":"none","stroke":"LIGHT"}}}]}}};

// hasOwnProperty, not Object.hasOwn (Safari 15.4+): see lib/pieceStyles' own.
const own = (obj, key) => obj != null && typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);

const paint = (style, light, dark) => {
  if (!style) return style;
  const out = {};
  for (const [k, v] of Object.entries(style)) {
    out[k] = v === 'LIGHT' ? light : (v === 'DARK' ? dark : v);
  }
  return out;
};

function render(node, light, dark, key, viewBox) {
  if (node == null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map((n, i) => render(n, light, dark, i));
  const props = { ...node.p, key };
  if (props.style) props.style = paint(props.style, light, dark);
  // The board decides the size; the original's fixed 45px would ignore it.
  // The drawing is decoration: the square says which piece stands there.
  if (node.t === 'svg') {
    props.width = '100%';
    props.height = '100%';
    props.viewBox = viewBox ?? node.p?.viewBox ?? '0 0 45 45';
    props['aria-hidden'] = 'true';
    props.focusable = 'false';
  }
  const kids = 'c' in node ? render(node.c, light, dark) : undefined;
  return React.createElement(node.t, props, kids);
}

// A set this build doesn't offer is drawn as the Default set; a set's
// drawings are TREES for Default and Court Cards, Chess Arcade's for the rest.
const knownSet = (set) => (isPieceStyle(set) ? set : 'default');
const treesOf = (set) => (drawnByTrees(set) || !own(PIECE_ART, set) ? TREES : PIECE_ART[set]);

// react-chessboard's customPieces map: { wP: ({ squareWidth }) => node, ... }
// data-pc names the piece on its own box, the one place a theme can reach it
// wherever it's drawn: on a square (inside react-chessboard's [data-piece]),
// in the promotion picker, and in the drag ghost, which react-chessboard draws
// without a [data-piece] around it. Court Cards prints its suits there.
// data-ps names the set (Court Cards' own look keys on it, wherever it's drawn).
// Each piece's drawing is made once, here, and the same element handed back on
// every render, so React never walks an unchanged piece again.
export function makePieces(light = DEFAULT_PIECE_LIGHT, dark = DEFAULT_PIECE_DARK, set = 'default') {
  const known = knownSet(set);
  const trees = treesOf(known);
  const viewBox = trees === TREES ? undefined : (fitViewBox(known) ?? undefined);
  const pieces = {};
  for (const [code, tree] of Object.entries(trees)) {
    const svg = trees === TREES ? render(tree, light, dark) : render(tree, undefined, undefined, undefined, viewBox);
    pieces[code] = ({ squareWidth }) => (
      <span data-pc={code} data-ps={known} style={{ width: squareWidth, height: squareWidth, display: 'block' }}>
        {svg}
      </span>
    );
  }
  return pieces;
}

// A little least-recently-used cache: a hit moves to the back, the oldest goes
// once it holds more than `size`.
function lru(size) {
  const map = new Map();
  return (key, make) => {
    if (map.has(key)) {
      const hit = map.get(key);
      map.delete(key);
      map.set(key, hit);
      return hit;
    }
    const made = make();
    map.set(key, made);
    if (map.size > size) map.delete(map.keys().next().value);
    return made;
  };
}

// The set a look (theme.js boardPieces) draws, as one map per look and the
// same map every time: react-chessboard remounts all 32 pieces, killing the
// move animation, whenever it's handed a new one. An art set's colors come
// from CSS, so it's one map whatever the inks. 16 looks are kept: a board in
// use has always just asked for its own, so dragging Custom's color picker
// through many inks can't push it out.
const pieceMaps = lru(16);
export function piecesFor(look) {
  const set = knownSet(look?.set);
  const light = look?.light ?? DEFAULT_PIECE_LIGHT;
  const dark = look?.dark ?? DEFAULT_PIECE_DARK;
  const key = treesOf(set) === TREES ? `${set}|${light}|${dark}` : set;
  return pieceMaps(key, () => makePieces(light, dark, set));
}

// One piece as a picture to lay on a square: an SVG data URL at `opacity` —
// the faded piece Before & After (components/MomentBoards) leaves where a
// piece used to stand, drawn under the board's own pieces and arrows. A
// picture sees no CSS, so an art set's colors go in as literals (the theme's
// piece colors, else the set's own), through the theme's drawing filter as
// numbers (pieceStyles' THEME_DRAWING_FILTERS), so a Game Boy ghost is as
// green as the pieces around it. The Default and Court Cards sets are drawn as
// they always have been: in the look's inks, no filter. The one exception is
// Q3's 'ca' answer (the look's inks: 'ca', from theme.js boardPieces): then
// the Default set is in Chess Arcade's cream and brown, which only the
// theme's filter turns green (or gray, or tinted) on the board, so its
// pictures go through that filter too.
const kebab = (k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const attr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
function toSvg(node, light, dark, opacity, art) {
  if (node == null || typeof node !== 'object') return '';
  if (Array.isArray(node)) return node.map((n) => toSvg(n, light, dark, opacity, art)).join('');
  const { style, ...props } = node.p ?? {};
  if (node.t === 'svg') Object.assign(props, { viewBox: art ? (art.viewBox ?? props.viewBox) : '0 0 45 45', opacity });
  const value = art ? art.color : (v) => v;
  const css = style ? Object.entries(paint(style, light, dark)).map(([k, v]) => `${kebab(k)}:${value(v)}`).join(';') : '';
  const attrs = Object.entries(props).map(([k, v]) => ` ${k === 'viewBox' ? k : kebab(k)}="${attr(v)}"`).join('');
  const kids = 'c' in node ? toSvg(node.c, light, dark, opacity, art) : '';
  return `<${node.t}${attrs}${css ? ` style="${attr(css)}"` : ''}>${kids}</${node.t}>`;
}
const images = lru(256);
export function pieceImage(code, look = {}, opacity = 0.3) {
  const set = knownSet(look?.set);
  const skin = look?.skin ?? null;
  const light = look?.light ?? DEFAULT_PIECE_LIGHT;
  const dark = look?.dark ?? DEFAULT_PIECE_DARK;
  const tokens = look?.tokens ?? {};
  const caInks = set === 'default' && look?.inks === 'ca';
  const trees = treesOf(set);
  if (!own(trees, code)) return null;
  const key = `${set}|${skin}|${code}|${light}|${dark}|${JSON.stringify(tokens)}|${opacity}${caInks ? '|ca' : ''}`;
  return images(key, () => {
    let art = null;
    if (caInks && own(THEME_DRAWING_FILTERS, skin)) {
      const steps = THEME_DRAWING_FILTERS[skin];
      art = { viewBox: '0 0 45 45', color: (v) => filterColor(literalColor(v, tokens), steps) };
    } else if (trees !== TREES) {
      const steps = set !== 'courtCards' && own(THEME_DRAWING_FILTERS, skin) ? THEME_DRAWING_FILTERS[skin] : null;
      art = {
        viewBox: fitViewBox(set) ?? undefined,
        color: (v) => {
          const lit = literalColor(v, tokens);
          return steps ? filterColor(lit, steps) : lit;
        },
      };
    }
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(toSvg(trees[code], light, dark, opacity, art))}`;
  });
}
