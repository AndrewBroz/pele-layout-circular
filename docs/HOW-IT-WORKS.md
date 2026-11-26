# How it works

This page explains how pele-layout-circular turns Pele's drawing into a
circular one. [Pele](https://pele.run) draws mermaid diagrams as SVG.
You don't need this page to use the package.

## The wrapper

Pele has no public way to add a layout. So this package wraps Pele's
flowchart diagram. `withCircularLayout(flowchart)` returns a flowchart
that behaves like Pele's own, except for diagrams that ask for
`layout: circular` or `layout: circular-ccw`.

For such a diagram, Pele first draws it with its own layout. The
wrapper keeps Pele's drawing of every node, edge label and group box.
It asks [layout-circular](https://github.com/AndrewBroz/layout-circular)
where each one goes. Then it moves each one there and redraws the
arrows along the circle.

Because the shapes are Pele's own, Pele's node shapes, colors and CSS
hooks carry over unchanged.

A layout hook for Pele is proposed in
[obsidianmd/pele#163](https://github.com/obsidianmd/pele/pull/163). If
it lands, this package becomes a plain layout registration.

## Groups

A group is a mermaid subgraph: a set of nodes drawn inside one shape.
Groups keep the circle whole. layout-circular turns the ring, or grows
it evenly, until each group's shape clears the nodes outside it and
the shapes beside it.

A group is drawn as a box or as a band.

A box hugs its members. Its sides use Pele's tight group padding. Its
top uses the room Pele leaves for a title.

A band is a curved strip that follows the ring. A group gets one when
its members span half the ring or more. A box that large would cover
the middle of the circle. The wrapper turns Pele's group rectangle into
a path for the band. The path keeps the rectangle's class, `data-id`,
fill and style, so themes and CSS still apply.

A band's title sits right outside the band. A band nested inside
another band puts its title between the two.

A box's title sits on top. layout-circular moves it to the bottom when
spokes or chords cross the top, as in a wheel.

The wrapper takes the first of Pele's three spots (left, middle, right)
that no arrow runs through. If arrows cross all three, the title goes
to the clear spot nearest the middle, which layout-circular finds. If
no spot along the edge is clear, the title goes in the middle.

## Ink and casings

Pele picks a text color for each fill, so text stays readable on it.
This color is called the ink. An arrow drawn over a group's fill takes
that fill's ink.

Where an arrow crosses a group's border, Pele draws a casing under it.
A casing is a thin outline in the background color. Pele draws it
under the arrowhead too, which blurs the arrowhead over a light fill
and outlines it in dark mode.

The wrapper draws no casings. It splits an arrow where it crosses a
border instead. Each part takes the ink of the fill it runs over, or
the plain line color off every fill, and the arrowhead takes the ink
under its tip. Each part reads on what is under it, so a crossing
needs no casing. Where the wrapper can't ink a line over a fill (the
line sets its own color, or the fill is too faint to pick an ink for),
the line keeps its own or plain color, uncased.

An arrow in one part is drawn as Pele draws it, with its ink on the
edge's group. An arrow in several parts has one path per part, and
each inked path carries its ink as its own `stroke`. So CSS that sets
`stroke` on the edge group (`.pele-edge`) no longer recolors an inked
part of a split arrow; aim it at `.pele-edge path` instead. Other
styles on the group, such as its opacity or width, still reach every
part. A solid arrow's parts meet with butt ends, so a stroke-opacity
doesn't darken the join. A dashed arrow's parts meet in a dash gap,
and its dashes run on from one part to the next.

This works over boxes and bands alike. For a band, the wrapper tests
the curved strip itself, not the rectangle around it.
