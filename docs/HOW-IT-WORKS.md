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

Because the shapes are Pele's own, Pele's node shapes, colours and CSS
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
spokes or chords cross the top, as in a wheel. Pele has three spots for
a title along an edge: left, middle and right. The wrapper takes the
first one that no arrow runs through. If arrows cross all three, it
takes the spot layout-circular chose: the one nearest the middle that
no arrow crosses, or the middle itself when every spot is crossed.

## Ink and casings

Pele picks a text colour for each fill, so text stays readable on it.
This colour is called the ink. An arrow drawn over a group's fill takes
that fill's ink.

Where an arrow crosses a group's border, Pele draws a casing under it.
A casing is a thin outline in the background colour. It keeps the line
readable where it crosses the border.

The wrapper does the same for its redrawn arrows, over boxes and bands
alike. For a band, it tests the curved strip itself, not the rectangle
around it.
